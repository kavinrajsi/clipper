// Highlight detection: transcript -> candidate moments.
//
// SERVER ONLY. Reads AI_GATEWAY_API_KEY (via the AI SDK's default gateway
// provider) and writes through a service-role client.
//
// The file is deliberately split into a pure half and an I/O half. Everything
// above `detectHighlights` is a plain function over plain data — segment
// flattening, prompt assembly, and validation of whatever the model returns.
// That half is exercised by `npm run highlights:check` against a fixture
// transcript, which is the only honest verification available while no gateway
// key exists. The model call itself is the one part that cannot be checked
// without one.

import { generateText, Output, jsonSchema } from "ai";

// Fetched live from the gateway's model list rather than recalled — see
// docs/manual-steps.md. Sonnet rather than Opus on purpose: this runs on every
// uploaded asset, the task is bounded (read a transcript, propose moments), and
// the cost difference is multiplied by every upload. Override per-deploy if a
// harder model turns out to matter.
export const HIGHLIGHT_MODEL = process.env.AI_HIGHLIGHT_MODEL ?? "anthropic/claude-sonnet-5";

// What we ask for. More than a brand will pick, because picking from a shortlist
// is the product and the model should not be doing the final curation.
const TARGET_CANDIDATES = 12;

// A clip that works as a standalone short. Outside this range it is either not
// a moment or not a clip.
const MIN_CLIP_SECONDS = 15;
const MAX_CLIP_SECONDS = 180;

const CANDIDATE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_seconds: { type: "number", description: "Where the moment starts." },
          end_seconds: { type: "number", description: "Where it ends." },
          title: { type: "string", description: "Six words or fewer, concrete." },
          rationale: {
            type: "string",
            description:
              "Why this stands alone without the surrounding conversation, and what makes it land.",
          },
          quote: {
            type: "string",
            description: "The single strongest line in the moment, verbatim from the transcript.",
          },
        },
        required: ["start_seconds", "end_seconds", "title", "rationale", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
});

/**
 * Flatten a stored transcript into timestamped lines.
 *
 * Speaker labels are kept where diarization produced them: on an interview,
 * knowing who spoke is most of knowing whether a moment stands alone.
 */
export function transcriptToLines(transcript) {
  const segments = transcript?.segments ?? [];

  return segments
    .filter((s) => s && typeof s.text === "string" && s.text.trim())
    .map((s) => {
      const at = Math.max(0, Math.floor(Number(s.start) || 0));
      const speaker = s.speaker ? `${s.speaker}: ` : "";
      return `[${formatClock(at)}] ${speaker}${s.text.trim()}`;
    });
}

function formatClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Seconds back out of a `[mm:ss]` / `[h:mm:ss]` stamp. */
export function clockToSeconds(clock) {
  const parts = String(clock).split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

export function buildPrompt({ lines, filename, brandVoice }) {
  const voice = brandVoice
    ? [
        "",
        "The brand describes its voice as follows. Prefer moments that suit it.",
        brandVoice.tone ? `Tone: ${brandVoice.tone}` : null,
        brandVoice.audience ? `Audience: ${brandVoice.audience}` : null,
        brandVoice.banned_terms?.length
          ? `Avoid moments built on: ${brandVoice.banned_terms.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return [
    `Below is a timestamped transcript of "${filename ?? "a recording"}".`,
    "",
    `Find up to ${TARGET_CANDIDATES} moments that would work as standalone short clips.`,
    "",
    "What makes a moment work:",
    "- It is comprehensible on its own, with no setup from the surrounding conversation.",
    "- Something actually happens: a claim, a reversal, a concrete story, a strong disagreement.",
    "- It opens on something that earns attention rather than building up to it.",
    "",
    "What to skip: introductions, housekeeping, sponsor reads, and anything that only",
    "makes sense if you heard the previous ten minutes.",
    "",
    `Each moment must be between ${MIN_CLIP_SECONDS} and ${MAX_CLIP_SECONDS} seconds long.`,
    "Use the timestamps in the transcript to set start and end, in seconds.",
    "Quote the strongest line verbatim — do not paraphrase it.",
    voice,
    "",
    "Transcript:",
    ...lines,
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/**
 * Take whatever the model returned and reduce it to rows worth storing.
 *
 * A schema guarantees the shape, not the sense: a model will happily return a
 * moment that runs past the end of the recording, or two that are the same
 * moment. This is the layer that decides what actually gets written, and it is
 * pure so it can be tested without a gateway key.
 */
export function validateCandidates(raw, { durationSeconds = null } = {}) {
  const rejected = [];
  const kept = [];

  for (const item of raw ?? []) {
    const start = Number(item?.start_seconds);
    const end = Number(item?.end_seconds);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      rejected.push({ item, why: "non-numeric bounds" });
      continue;
    }
    if (start < 0 || end <= start) {
      rejected.push({ item, why: "end must be after start" });
      continue;
    }

    const length = end - start;
    if (length < MIN_CLIP_SECONDS || length > MAX_CLIP_SECONDS) {
      rejected.push({ item, why: `length ${Math.round(length)}s outside clip range` });
      continue;
    }
    // A moment past the end of the recording is a hallucinated timestamp, not a
    // clip. Only checkable when the transcript gave us a duration.
    if (durationSeconds && end > durationSeconds + 1) {
      rejected.push({ item, why: "runs past the end of the recording" });
      continue;
    }
    // Same moment proposed twice with slightly different bounds.
    if (kept.some((k) => overlapRatio(k, { start, end }) > 0.5)) {
      rejected.push({ item, why: "duplicates an earlier candidate" });
      continue;
    }

    kept.push({
      start,
      end,
      title: trim(item.title, 120),
      rationale: trim(item.rationale, 1000),
      quote: trim(item.quote, 1000),
    });
  }

  kept.sort((a, b) => a.start - b.start);
  return { kept, rejected };
}

function overlapRatio(a, b) {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a.end - a.start, b.end - b.start);
}

function trim(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Run detection for one asset. Enqueues an ai_job, calls the model, writes the
 * candidates, and completes the job — or fails it with the reason.
 */
export async function detectHighlights(admin, { asset, userId, brandVoice = null }) {
  const { enqueueJob, startJob, completeJob, failJob } = await import("@/lib/ai/jobs");

  const lines = transcriptToLines(asset.transcript);
  if (lines.length === 0) {
    const error = new Error("That recording has no transcript to analyse yet.");
    error.status = 409;
    throw error;
  }

  const job = await enqueueJob(admin, {
    workspaceId: asset.workspace_id,
    userId,
    kind: "highlight_detect",
    subjectType: "source_asset",
    subjectId: asset.id,
    input: { segments: lines.length },
  });

  await startJob(admin, job.id, { model: HIGHLIGHT_MODEL });

  try {
    const { output, usage } = await generateText({
      model: HIGHLIGHT_MODEL,
      output: Output.object({ schema: CANDIDATE_SCHEMA }),
      prompt: buildPrompt({ lines, filename: asset.filename, brandVoice }),
    });

    const { kept, rejected } = validateCandidates(output?.candidates, {
      durationSeconds: asset.duration_seconds,
    });

    if (kept.length === 0) {
      throw new Error("The model did not return any usable moments for this recording.");
    }

    // Replace rather than append: re-running detection should not leave the
    // brand picking from two generations of suggestions. Deletion is
    // service-role only — there is no client delete policy.
    await admin.from("highlight_candidates").delete().eq("source_asset_id", asset.id);

    const { error: insertError } = await admin.from("highlight_candidates").insert(
      kept.map((c) => ({
        source_asset_id: asset.id,
        start_seconds: c.start,
        end_seconds: c.end,
        title: c.title,
        rationale: c.rationale,
        quote: c.quote,
      }))
    );

    if (insertError) throw new Error(`Could not save the moments: ${insertError.message}`);

    await admin.from("source_assets").update({ status: "ready" }).eq("id", asset.id);

    await completeJob(admin, job.id, {
      output: { kept: kept.length, rejected: rejected.map((r) => r.why) },
      tokensUsed: usage?.totalTokens ?? null,
      creditsCharged: 0,
    });

    return { job, candidates: kept.length, rejected: rejected.length };
  } catch (error) {
    await failJob(admin, job.id, error.message);
    throw error;
  }
}
