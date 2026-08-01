// Turn an asset's picked moments into a draft campaign.
//
// The Phase 3 exit criterion runs through here. Authorisation follows the rule
// in AGENTS.md: RLS-scoped client first, admin client only after membership is
// proven.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceRole, CAMPAIGN_ROLES } from "@/lib/workspaces";
import { generateBrief } from "@/lib/ai/brief";

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

  const { data: asset } = await supabase
    .from("source_assets")
    .select("id, workspace_id, filename")
    .eq("id", id)
    .maybeSingle();

  const role = asset ? await getWorkspaceRole(supabase, user, asset.workspace_id) : null;

  if (!asset || !role || !CAMPAIGN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  // Read the picked moments through RLS — the same rows the brand is looking at.
  const { data: moments } = await supabase
    .from("highlight_candidates")
    .select("id, start_seconds, end_seconds, title, rationale, quote")
    .eq("source_asset_id", asset.id)
    .eq("selected", true)
    .order("start_seconds", { ascending: true });

  if (!moments?.length) {
    return NextResponse.json({ error: "Pick at least one moment first." }, { status: 409 });
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return NextResponse.json(
      { error: "Brief generation isn't configured yet." },
      { status: 503 }
    );
  }

  const { data: brandVoice } = await supabase
    .from("brand_voice")
    .select("tone, audience, banned_terms, required_disclosures")
    .eq("workspace_id", asset.workspace_id)
    .maybeSingle();

  const admin = createAdminClient();

  try {
    const result = await generateBrief(admin, {
      asset,
      moments,
      userId: user.id,
      brandVoice,
    });

    return NextResponse.json({
      ok: true,
      campaignId: result.campaign.id,
      title: result.campaign.title,
      moments: result.moments,
    });
  } catch (error) {
    if (error.status === 409) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("brief generation failed", error);
    return NextResponse.json({ error: "Could not write the brief." }, { status: 502 });
  }
}
