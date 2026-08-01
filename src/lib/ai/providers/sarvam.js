// Sarvam AI — batch speech-to-text.
//
// SERVER ONLY. Reads SARVAM_API_KEY.
//
// Why the batch API and not the simple one: Sarvam's synchronous
// POST /speech-to-text caps at 30 SECONDS of audio. A podcast episode is two
// orders of magnitude past that, so the batch flow is the only option, not an
// optimisation.
//
// The flow is five calls, and the order matters:
//
//   1. initJob()        -> job_id
//   2. uploadUrls()     -> one presigned PUT url per file
//   3. PUT the audio    -> straight to Sarvam's storage
//   4. startJob()       -> processing begins
//   5. status()/download() -> transcript, via webhook poke or the cron poller
//
// Note (4) is separate from (3): nothing is transcribed until the job is
// explicitly started, so a failed upload leaves an idle job rather than a
// half-processed one.
//
// ⚠ UNVERIFIED. Written against Sarvam's published docs and their official
// skills repo, but never run — no SARVAM_API_KEY exists yet. `npm run
// sarvam:probe` exercises every call below against the real API and is the
// thing that turns this from "written" into "working". Do not assume the
// request/response shapes here are right until that probe has passed.

const BASE_URL = "https://api.sarvam.ai/v1";

// saaras:v3 — 23 languages (22 Indian + English), automatic language detection,
// and code-mixed Hinglish/Tanglish, which is the actual reason this vendor was
// chosen over the Western alternatives.
export const SARVAM_MODEL = "saaras:v3";

// Sarvam's own ceiling. Enforced before enqueue rather than discovered halfway
// through a paid job.
export const MAX_AUDIO_SECONDS = 2 * 60 * 60;

// Refuse to relay past this. A function has 300s of wall clock; ~100MB of audio
// moves in seconds, multiple gigabytes of video does not, and dying at the
// timeout with nothing written is the worst available outcome.
export const MAX_RELAY_BYTES = 2 * 1024 * 1024 * 1024;

function apiKey() {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new Error("SARVAM_API_KEY is not set — transcription cannot run.");
  }
  return key;
}

async function sarvamFetch(path, { method = "POST", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      // Not `Authorization: Bearer`. Sarvam uses its own header name, and
      // getting this wrong returns a 403 that reads like a bad key.
      "api-subscription-key": apiKey(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail = payload?.message ?? payload?.error ?? text.slice(0, 300);
    const error = new Error(`Sarvam ${method} ${path} failed (${response.status}): ${detail}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

/**
 * Create a batch job. Returns Sarvam's job id, which must be persisted before
 * any bytes move — see the migration comment on ai_jobs.provider_job_id.
 *
 * Diarization is on by default: knowing who is speaking materially improves
 * highlight detection on interviews and podcasts, and the difference is
 * ₹45/hour against ₹30, which is noise next to what a campaign is worth.
 */
export async function initJob({ languageCode = "unknown", withDiarization = true, callbackUrl, callbackToken } = {}) {
  const body = {
    job_parameters: {
      model: SARVAM_MODEL,
      mode: "transcribe",
      language_code: languageCode,
      with_diarization: withDiarization,
      with_timestamps: true,
    },
  };

  if (callbackUrl) {
    body.callback = { url: callbackUrl, auth_token: callbackToken };
  }

  const data = await sarvamFetch("/speech-to-text/job/v1", { body });
  return { jobId: data?.job_id ?? data?.id, raw: data };
}

/** Presigned PUT urls for the files this job will process. */
export async function uploadUrls(jobId, fileNames) {
  const data = await sarvamFetch("/speech-to-text/job/v1/upload-urls", {
    body: { job_id: jobId, file_names: fileNames },
  });
  return data?.upload_urls ?? data?.urls ?? [];
}

/**
 * PUT one file to a presigned url.
 *
 * `Content-Length` is set explicitly and the body is a Buffer rather than a
 * stream: presigned PUT targets generally reject chunked transfer encoding, and
 * a streamed body without a known length is exactly what produces it. Azure SAS
 * targets additionally need x-ms-blob-type, so it is sent unconditionally —
 * harmless on S3-style targets, and the failure it prevents is a 400 that reads
 * like a malformed request.
 */
export async function putFile(uploadUrl, bytes, contentType) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "x-ms-blob-type": "BlockBlob",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: bytes,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Upload to the provider failed (${response.status}): ${detail}`);
  }
}

/** Begin processing. Nothing is transcribed — or billed — until this is called. */
export async function startJob(jobId) {
  return sarvamFetch("/speech-to-text/job/v1/start", { body: { job_id: jobId } });
}

/** Terminal states are Completed and Failed; Accepted/Pending/Running are not. */
export async function jobStatus(jobId) {
  return sarvamFetch(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`, {
    method: "GET",
  });
}

/**
 * Fetch the transcript.
 *
 * This exists as a separate step because **the webhook does not carry the
 * transcript** — only a job state. The callback is a poke; this is the payload.
 */
export async function downloadOutputs(jobId, files) {
  return sarvamFetch("/speech-to-text/job/v1/download-files", {
    body: { job_id: jobId, files },
  });
}

export function isTerminalJobState(state) {
  return state === "Completed" || state === "Failed";
}

/**
 * The prepare-audio seam.
 *
 * Today this is the identity function: the stored bytes go to Sarvam exactly as
 * uploaded. Whether Sarvam demuxes an MP4 is undocumented — every comparable
 * hosted STT does, and most video podcasts are AAC-in-MP4, but that is a prior,
 * not a fact, and `npm run sarvam:probe` settles it.
 *
 * If the probe shows video is rejected, ffmpeg audio extraction goes HERE and
 * nowhere else — enqueue, relay, webhook and download all stay untouched. That
 * is the whole reason this function exists while doing nothing.
 */
export async function prepareAudio({ bytes, filename, mimeType }) {
  return { bytes, filename, mimeType };
}
