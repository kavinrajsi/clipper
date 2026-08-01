// Run highlight detection over a transcribed asset.
//
// Authorisation follows the rule in AGENTS.md: authenticate and prove workspace
// membership on the RLS-scoped client first, then the admin client, then the
// pipeline. The model call can take a while on a long transcript, hence
// maxDuration.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceRole, CAMPAIGN_ROLES } from "@/lib/workspaces";
import { detectHighlights } from "@/lib/ai/highlights";

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

  // The transcript is genuinely needed here, unlike the /studio listing which
  // deliberately never selects it.
  const { data: asset } = await supabase
    .from("source_assets")
    .select("id, workspace_id, filename, duration_seconds, status, transcript")
    .eq("id", id)
    .maybeSingle();

  const role = asset ? await getWorkspaceRole(supabase, user, asset.workspace_id) : null;

  if (!asset || !role || !CAMPAIGN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  if (!asset.transcript) {
    return NextResponse.json(
      { error: "Transcribe this recording first." },
      { status: 409 }
    );
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return NextResponse.json(
      { error: "Highlight detection isn't configured yet." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();

  // Brand voice conditions which moments get proposed. Absent is fine — the
  // table is workspace-scoped and most workspaces will not have set one.
  const { data: brandVoice } = await supabase
    .from("brand_voice")
    .select("tone, audience, banned_terms")
    .eq("workspace_id", asset.workspace_id)
    .maybeSingle();

  try {
    const result = await detectHighlights(admin, { asset, userId: user.id, brandVoice });
    return NextResponse.json({ ok: true, ...result, jobId: result.job.id });
  } catch (error) {
    if (error.status === 409) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("highlight detection failed", error);
    return NextResponse.json({ error: "Could not analyse this recording." }, { status: 502 });
  }
}
