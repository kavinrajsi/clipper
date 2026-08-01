import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceRole, CAMPAIGN_ROLES } from "@/lib/workspaces";
import { HighlightCandidatesList } from "@/components/highlight-candidates-list";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

export default async function StudioAssetPage({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/studio/${id}`);
  }

  // No `transcript` here either — the page shows moments, not the raw text, and
  // a two-hour diarized transcript is megabytes.
  const { data: asset } = await supabase
    .from("source_assets")
    .select("id, workspace_id, filename, status, duration_seconds, created_at, error")
    .eq("id", id)
    .maybeSingle();

  const role = asset ? await getWorkspaceRole(supabase, user, asset.workspace_id) : null;

  if (!asset || !role) {
    redirect("/studio");
  }

  const { data: candidates } = await supabase
    .from("highlight_candidates")
    .select("id, start_seconds, end_seconds, title, rationale, quote, selected, campaign_id")
    .eq("source_asset_id", asset.id)
    .order("start_seconds", { ascending: true });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <Button variant="ghost" size="sm" render={<Link href="/studio" />} nativeButton={false}>
          <ArrowLeftIcon />
          Studio
        </Button>

        <h1 className="mt-2 text-2xl font-bold">{asset.filename}</h1>
        <p className="text-sm text-muted-foreground">
          Uploaded {formatDate(asset.created_at)}
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <HighlightCandidatesList
          asset={asset}
          candidates={candidates ?? []}
          canManage={CAMPAIGN_ROLES.includes(role)}
        />
      </div>
    </div>
  );
}
