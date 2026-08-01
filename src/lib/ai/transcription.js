// Transcription orchestration: source asset -> Sarvam batch job -> transcript.
//
// SERVER ONLY. Every function takes a service-role client, because both
// `ai_jobs` (no client write policies at all) and `source_assets.status` /
// `.transcript` (guarded by a trigger keyed on auth.uid() being null) are
// writable only by the pipeline.
//
// The design point worth knowing before editing: **this is poll-first.** The
// webhook is a latency optimisation, not the mechanism. Sarvam's callback
// carries a job state and no transcript, so the handler can only do what the
// poller already does — and webhooks get dropped. `reconcileJob` is therefore
// the single path to completion, called from both, and made safe to run twice
// by the open-state filters in jobs.js.

import { createClient } from "@supabase/supabase-js";
import {
  MAX_AUDIO_SECONDS,
  MAX_RELAY_BYTES,
  downloadOutputs,
  initJob,
  isTerminalJobState,
  jobStatus,
  prepareAudio,
  putFile,
  startJob as startProviderJob,
  uploadUrls,
} from "@/lib/ai/providers/sarvam";
import { SOURCE_ASSETS_BUCKET } from "@/lib/storage";
import { completeJob, enqueueJob, failJob, startJob } from "@/lib/ai/jobs";

// A relay that has been running longer than this is not coming back — the
// function that owned it is long dead. Generous against the 300s function
// ceiling so a slow-but-alive job is never killed.
const STUCK_AFTER_MS = 30 * 60 * 1000;

export class TranscriptionRefused extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "TranscriptionRefused";
    this.status = status;
  }
}

function callbackUrl() {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/api/ai/webhook/sarvam`;
}

/**
 * Kick off transcription for a source asset.
 *
 * Refusals (thrown as TranscriptionRefused) happen up front, before a job row
 * or a paid provider job exists. The asset is left in whatever state it was —
 * a policy limit is not a broken file, and the asset is still perfectly usable
 * for manual clipping.
 */
export async function startTranscription(admin, { asset, userId }) {
  if (asset.status === "transcribing" || asset.status === "analysing") {
    throw new TranscriptionRefused("That recording is already being processed.", 409);
  }

  if (asset.duration_seconds && asset.duration_seconds > MAX_AUDIO_SECONDS) {
    throw new TranscriptionRefused(
      "Recordings over 2 hours can't be transcribed yet — split the file and upload the parts."
    );
  }

  if (asset.size_bytes && asset.size_bytes > MAX_RELAY_BYTES) {
    throw new TranscriptionRefused(
      "That file is too large to send for transcription. Upload the audio track on its own."
    );
  }

  const job = await enqueueJob(admin, {
    workspaceId: asset.workspace_id,
    userId,
    kind: "transcribe",
    subjectType: "source_asset",
    subjectId: asset.id,
    input: { storage_path: asset.storage_path, filename: asset.filename },
  });

  await startJob(admin, job.id, { model: "saaras:v3" });

  try {
    const { jobId: providerJobId } = await initJob({
      callbackUrl: callbackUrl(),
      callbackToken: process.env.SARVAM_CALLBACK_TOKEN ?? undefined,
    });

    if (!providerJobId) throw new Error("The provider did not return a job id.");

    // Persisted BEFORE any bytes move. If the relay below dies, this row is the
    // only thing that can find the orphaned provider job again.
    await admin.from("ai_jobs").update({ provider_job_id: providerJobId }).eq("id", job.id);
    await admin.from("source_assets").update({ status: "transcribing" }).eq("id", asset.id);

    const bytes = await downloadAsset(admin, asset);
    const prepared = await prepareAudio({
      bytes,
      filename: asset.filename ?? "recording",
      mimeType: asset.mime_type,
    });

    const urls = await uploadUrls(providerJobId, [prepared.filename]);
    const target = typeof urls[0] === "string" ? urls[0] : urls[0]?.url;
    if (!target) throw new Error("The provider did not return an upload URL.");

    await putFile(target, prepared.bytes, prepared.mimeType);
    await startProviderJob(providerJobId);

    return { job, providerJobId };
  } catch (error) {
    await failJob(admin, job.id, error.message);
    await admin
      .from("source_assets")
      .update({ status: "failed", error: error.message.slice(0, 500) })
      .eq("id", asset.id);
    throw error;
  }
}

/**
 * Pull the object out of Supabase Storage as a Buffer.
 *
 * Buffered rather than streamed on purpose: a presigned PUT needs a
 * Content-Length, and a streamed body without one becomes chunked, which those
 * targets reject. At the sizes this path allows, buffering is also simply
 * simpler. MAX_RELAY_BYTES is what keeps that honest.
 */
async function downloadAsset(admin, asset) {
  const { data, error } = await admin.storage
    .from(SOURCE_ASSETS_BUCKET)
    .download(asset.storage_path);

  if (error || !data) {
    throw new Error(`Could not read the recording from storage: ${error?.message ?? "missing"}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());

  if (buffer.byteLength > MAX_RELAY_BYTES) {
    throw new Error("That file is too large to send for transcription.");
  }

  return buffer;
}

/**
 * Advance one in-flight job. Safe to call repeatedly and concurrently — every
 * write filters on the open states, so the webhook and the poller racing each
 * other resolves to one winner and one no-op.
 */
export async function reconcileJob(admin, job) {
  if (!job.provider_job_id) return { status: "no-provider-job" };

  const status = await jobStatus(job.provider_job_id);
  const state = status?.job_state ?? status?.status;

  if (!isTerminalJobState(state)) return { status: "pending", state };

  if (state === "Failed") {
    const message = status?.error?.message ?? "The provider could not transcribe this recording.";
    await failJob(admin, job.id, message);
    await admin
      .from("source_assets")
      .update({ status: "failed", error: String(message).slice(0, 500) })
      .eq("id", job.subject_id);
    return { status: "failed" };
  }

  // Completed. The transcript is NOT in the webhook and NOT in the status —
  // it has to be fetched.
  const files = (status?.job_details ?? [])
    .map((d) => d?.output_file_name ?? d?.file_name)
    .filter(Boolean);

  const output = await downloadOutputs(job.provider_job_id, files.length ? files : ["0.json"]);
  const transcript = normaliseTranscript(output);

  await admin
    .from("source_assets")
    .update({
      status: "ready",
      transcript,
      duration_seconds: transcript?.duration_seconds ?? null,
      error: null,
    })
    .eq("id", job.subject_id);

  await completeJob(admin, job.id, {
    output: { provider_job_id: job.provider_job_id, files },
    // Priced per second of audio; the ledger that spends this arrives in
    // Phase 4, so it is recorded and not yet enforced.
    creditsCharged: 0,
  });

  return { status: "succeeded" };
}

/**
 * Sweep jobs whose relay died mid-flight.
 *
 * Without this they sit in `running` forever: the terminal-status constraint
 * means nothing else will ever move them. Where a provider job id was recorded
 * we reconcile instead of failing — the provider may well have finished the
 * work we stopped watching.
 */
export async function sweepStuckJobs(admin) {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

  const { data: stuck } = await admin
    .from("ai_jobs")
    .select("id, subject_id, provider_job_id, started_at")
    .eq("status", "running")
    .lt("started_at", cutoff)
    .limit(50);

  const results = [];

  for (const job of stuck ?? []) {
    if (job.provider_job_id) {
      try {
        results.push({ id: job.id, ...(await reconcileJob(admin, job)) });
        continue;
      } catch {
        // Fall through and fail it — an unreachable provider job that has been
        // running for half an hour is not going to resolve itself.
      }
    }

    await failJob(admin, job.id, "Transcription stopped responding and was timed out.");
    await admin
      .from("source_assets")
      .update({ status: "failed", error: "Transcription timed out." })
      .eq("id", job.subject_id);
    results.push({ id: job.id, status: "timed-out" });
  }

  return results;
}

/** All jobs still in flight, for the poller. */
export async function pendingTranscriptionJobs(admin, limit = 25) {
  const { data } = await admin
    .from("ai_jobs")
    .select("id, subject_id, provider_job_id, started_at")
    .eq("kind", "transcribe")
    .eq("status", "running")
    .not("provider_job_id", "is", null)
    .limit(limit);

  return data ?? [];
}

/** Look a job up from a webhook payload. */
export async function findJobByProviderId(admin, providerJobId) {
  const { data } = await admin
    .from("ai_jobs")
    .select("id, subject_id, provider_job_id, status")
    .eq("provider_job_id", providerJobId)
    .in("status", ["queued", "running"])
    .maybeSingle();

  return data;
}

/**
 * Flatten the provider's response into the shape the rest of Phase 3 reads.
 *
 * Highlight detection wants segments with timestamps and a speaker; keeping the
 * provider's raw shape here would make slice 3.4 depend on Sarvam specifically.
 */
function normaliseTranscript(output) {
  const first = Array.isArray(output) ? output[0] : (output?.files?.[0] ?? output);
  const entries = first?.diarized_transcript?.entries ?? first?.entries ?? [];

  const segments = entries.map((entry) => ({
    start: entry.start_time_seconds ?? entry.start ?? null,
    end: entry.end_time_seconds ?? entry.end ?? null,
    speaker: entry.speaker_id ?? entry.speaker ?? null,
    text: entry.transcript ?? entry.text ?? "",
  }));

  const last = segments[segments.length - 1];

  return {
    provider: "sarvam",
    model: "saaras:v3",
    language_code: first?.language_code ?? null,
    text: first?.transcript ?? segments.map((s) => s.text).join(" ").trim(),
    segments,
    duration_seconds: last?.end ? Math.ceil(last.end) : null,
  };
}

/** Service-role client for the cron route, which has no signed-in user. */
export function createPipelineClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
