import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PaperclipIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace, getWorkspaceRole } from "@/lib/workspaces";
import { BrandAssetsManager } from "@/components/brand-assets-manager";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function WorkspaceAssetsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/workspace/assets");
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
                <PaperclipIcon />
              </EmptyMedia>
              <EmptyTitle>No workspace yet</EmptyTitle>
              <EmptyDescription>
                Workspaces are created for brand accounts. Switch your role to Brand on your
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
    .from("brand_assets")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Brand assets</h1>
        <p className="text-sm text-muted-foreground">
          Logos, fonts, music and stings. Creators you&apos;ve approved can download these, which
          is the cheapest way to stop re-litigating brand presentation in every revision.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <BrandAssetsManager
          workspaceId={workspace.id}
          assets={assets ?? []}
          canManage={Boolean(role)}
        />
      </div>
    </div>
  );
}
