// Start transcription for a source asset.
//
// Authorisation follows the rule in AGENTS.md: authenticate and prove workspace
// membership on the RLS-scoped client FIRST, then create the admin client, and
// only then touch anything the pipeline owns.
//
// This route relays the audio itself, so it needs the full function budget —
// hence maxDuration. It is the only route in the project that sets one.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceRole, CAMPAIGN_ROLES } from "@/lib/workspaces";
import { TranscriptionRefused, startTranscription } from "@/lib/ai/transcription";

export const maxDuration = 300;

export async function POST(request, { params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Read through RLS. A non-member gets nothing back, which collapses into the
  // same 404 as a missing asset.
  const { data: asset } = await supabase
    .from("source_assets")
    .select("id, workspace_id, storage_path, filename, mime_type, size_bytes, duration_seconds, status")
    .eq("id", id)
    .maybeSingle();

  const role = asset ? await getWorkspaceRole(supabase, user, asset.workspace_id) : null;

  if (!asset || !role || !CAMPAIGN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  if (!process.env.SARVAM_API_KEY) {
    return NextResponse.json(
      { error: "Transcription isn't configured yet." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();

  try {
    const { job } = await startTranscription(admin, { asset, userId: user.id });
    return NextResponse.json({ ok: true, jobId: job.id, status: "transcribing" });
  } catch (error) {
    if (error instanceof TranscriptionRefused) {
      // Deliberately not a failure of the asset — a policy limit leaves the
      // recording exactly as it was, still usable for manual clipping.
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("transcription failed to start", error);
    return NextResponse.json(
      { error: "Could not start transcription." },
      { status: 502 }
    );
  }
}
