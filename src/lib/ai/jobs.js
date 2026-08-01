// The write half of the AI job queue.
//
// SERVER ONLY. Every function here takes a service-role client, because
// `ai_jobs` has no insert/update/delete policy at all — status, model,
// tokens_used and credits_charged are the provider's account of what happened
// and what it cost, and a client that can write them can mark its own job
// succeeded for free.
//
// The client is a parameter rather than something this module creates, so the
// escalation stays visible at the call site. Callers must follow the rule in
// AGENTS.md: authenticate and check ownership on the RLS-scoped client FIRST,
// then create the admin client, then call in here. Never import this from a
// "use client" file.

// Mirrors the CHECK constraints in
// 20260801043611_ai_jobs_and_brand_voice.sql. Duplicated on purpose: catching a
// bad kind here gives the caller a real error instead of a 23514 from Postgres.
export const JOB_KINDS = [
  "transcribe",
  "highlight_detect",
  "viral_score",
  "hook",
  "caption",
  "subtitle",
  "thumbnail",
  "quality_score",
  "edit_suggestions",
  "hashtags",
];

export const JOB_SUBJECT_TYPES = [
  "source_asset",
  "highlight_candidate",
  "submission",
  "campaign",
];

const TERMINAL = ["succeeded", "failed", "cancelled"];
// The states a job can still move on from. Every transition below filters on
// this, so a second webhook delivery for a job that already finished updates
// nothing instead of overwriting the first result — the same idempotency guard
// the Razorpay webhook uses.
const OPEN = ["queued", "running"];

function fail(action, error) {
  throw new Error(`Could not ${action} the AI job: ${error.message}`);
}

/**
 * Queue a job. `workspaceId` is nullable — a clipper's quality score or editing
 * suggestions have no workspace, and `userId` is the owner every job has.
 */
export async function enqueueJob(admin, {
  workspaceId = null,
  userId,
  kind,
  subjectType = null,
  subjectId = null,
  input = null,
}) {
  if (!userId) throw new Error("enqueueJob needs a userId.");
  if (!JOB_KINDS.includes(kind)) {
    throw new Error(`Unknown AI job kind "${kind}".`);
  }
  // The table enforces this too (ai_jobs_subject_paired); checking here names
  // which half is missing.
  if (Boolean(subjectType) !== Boolean(subjectId)) {
    throw new Error("An AI job subject needs both subject_type and subject_id, or neither.");
  }
  if (subjectType && !JOB_SUBJECT_TYPES.includes(subjectType)) {
    throw new Error(`Unknown AI job subject type "${subjectType}".`);
  }

  const { data, error } = await admin
    .from("ai_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      kind,
      subject_type: subjectType,
      subject_id: subjectId,
      input,
    })
    .select()
    .single();

  if (error) fail("queue", error);
  return data;
}

/** Mark a queued job as running. Returns null if it was already picked up. */
export async function startJob(admin, id, { model = null } = {}) {
  const { data, error } = await admin
    .from("ai_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), model })
    .eq("id", id)
    .eq("status", "queued")
    .select()
    .maybeSingle();

  if (error) fail("start", error);
  return data;
}

/**
 * Record a successful result. Credits are charged HERE and nowhere else —
 * docs/product/03-ai.md is explicit that a failed job must not bill, so
 * `failJob` leaves credits_charged at its default of 0.
 *
 * Returns null if the job had already reached a terminal state, which is what
 * makes a duplicate webhook delivery harmless.
 */
export async function completeJob(admin, id, {
  output = null,
  model = null,
  tokensUsed = null,
  creditsCharged = 0,
} = {}) {
  const patch = {
    status: "succeeded",
    // Not optional: ai_jobs_completed_at_matches_status rejects a terminal row
    // without it, because a poller would read it as permanently in flight.
    completed_at: new Date().toISOString(),
    output,
    tokens_used: tokensUsed,
    credits_charged: creditsCharged,
  };
  // Leave whatever startJob recorded rather than nulling it.
  if (model !== null) patch.model = model;

  const { data, error } = await admin
    .from("ai_jobs")
    .update(patch)
    .eq("id", id)
    .in("status", OPEN)
    .select()
    .maybeSingle();

  if (error) fail("complete", error);
  return data;
}

/** Record a failure. Never charges credits. */
export async function failJob(admin, id, message) {
  const { data, error } = await admin
    .from("ai_jobs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error: String(message ?? "Unknown error").slice(0, 2000),
    })
    .eq("id", id)
    .in("status", OPEN)
    .select()
    .maybeSingle();

  if (error) fail("fail", error);
  return data;
}

/** Cancel a job that has not finished. Never charges credits. */
export async function cancelJob(admin, id) {
  const { data, error } = await admin
    .from("ai_jobs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", OPEN)
    .select()
    .maybeSingle();

  if (error) fail("cancel", error);
  return data;
}

export function isTerminal(job) {
  return TERMINAL.includes(job?.status);
}
