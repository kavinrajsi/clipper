import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FilmIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace, getWorkspaceRole, CAMPAIGN_ROLES } from "@/lib/workspaces";
import { SourceAssetsManager } from "@/components/source-assets-manager";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function StudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/studio");
  }

  const cookieStore = await cookies();
  const workspace = await getActiveWorkspace(supabase, user, cookieStore);

  if (!workspace) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="mx-auto w-full max-w-3xl">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FilmIcon />
              </EmptyMedia>
              <EmptyTitle>No workspace yet</EmptyTitle>
              <EmptyDescription>
                Studio uploads belong to a brand workspace. Switch your role to Brand on your
                profile and one appears automatically.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    );
  }

  const role = await getWorkspaceRole(supabase, user, workspace.id);

  // RLS scopes this to the workspace; the explicit filter keeps the intent
  // visible at the call site.
  const { data: assets } = await supabase
    .from("source_assets")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Studio</h1>
        <p className="text-sm text-muted-foreground">
          Upload the long-form recording once. The brief gets written from the content instead
          of from a blank page — which is a much easier job, and gives creators timestamps to
          work against rather than adjectives.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <SourceAssetsManager
          workspaceId={workspace.id}
          assets={assets ?? []}
          canManage={CAMPAIGN_ROLES.includes(role)}
        />
      </div>
    </div>
  );
}
