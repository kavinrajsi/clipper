// Sarvam batch-job callback.
//
// Auth for this route is the shared token below, not a session — Sarvam arrives
// unauthenticated, the same shape as /api/payments/webhook, which verifies a
// signature rather than a user. `/api/ai/webhook` must therefore stay OUT of
// PROTECTED_PATH_PREFIXES in src/lib/supabase/proxy.js, or the proxy redirects
// the callback to /login and every delivery is silently lost.
//
// **The callback carries a job state and no transcript.** So this handler does
// not parse a result — it pokes the same reconcile routine the cron poller
// runs, which fetches the transcript itself. That is also why the poller is the
// real mechanism and this is only a latency optimisation: a dropped webhook
// costs a few minutes, not a stuck job.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createPipelineClient,
  findJobByProviderId,
  reconcileJob,
} from "@/lib/ai/transcription";

export const maxDuration = 300;

function tokenMatches(provided) {
  const expected = process.env.SARVAM_CALLBACK_TOKEN;
  if (!expected || !provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length — compare lengths first and always return a boolean.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!tokenMatches(request.headers.get("x-sarvam-job-callback-token"))) {
    return NextResponse.json({ error: "Invalid callback token" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const providerJobId = payload?.job_id ?? payload?.id;

  if (!providerJobId) {
    return NextResponse.json({ error: "No job id in payload" }, { status: 400 });
  }

  const admin = createPipelineClient();
  const job = await findJobByProviderId(admin, providerJobId);

  // Already reconciled by the poller, or belongs to nothing we know about.
  // Either way this is a 200: a webhook that keeps getting retried because we
  // answered 404 to a job we already finished is noise, not information.
  if (!job) return NextResponse.json({ ok: true, status: "already-settled" });

  try {
    const result = await reconcileJob(admin, job);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("sarvam webhook reconcile failed", error);
    // 500 so Sarvam retries — and the poller will get it regardless.
    return NextResponse.json({ error: "Could not reconcile the job." }, { status: 500 });
  }
}
