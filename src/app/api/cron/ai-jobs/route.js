// The transcription poller — the actual mechanism, not a backstop.
//
// Sarvam's webhook is a poke that can be dropped, and a dropped poke against an
// API nobody has ever called is undebuggable. So this route does the same
// reconcile work on a schedule, and the webhook just gets there sooner. The
// open-state filters in jobs.js make the two racing each other harmless.
//
// It also sweeps jobs whose relay died mid-flight. Nothing else can: the
// terminal-status-requires-completed_at constraint means a `running` row with a
// dead owner sits there forever otherwise.
//
// Auth is a shared secret, matching how Vercel Cron authenticates — there is no
// user here.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createPipelineClient,
  pendingTranscriptionJobs,
  reconcileJob,
  sweepStuckJobs,
} from "@/lib/ai/transcription";

export const maxDuration = 300;

function authorised(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function run() {
  const admin = createPipelineClient();
  const jobs = await pendingTranscriptionJobs(admin);

  const reconciled = [];
  for (const job of jobs) {
    try {
      reconciled.push({ id: job.id, ...(await reconcileJob(admin, job)) });
    } catch (error) {
      // One unreachable job must not stop the rest of the tick. It stays
      // `running` and either resolves next tick or gets swept.
      console.error(`reconcile failed for ${job.id}`, error);
      reconciled.push({ id: job.id, status: "error" });
    }
  }

  const swept = await sweepStuckJobs(admin);
  return { checked: jobs.length, reconciled, swept };
}

export async function GET(request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await run()) });
}

export const POST = GET;
