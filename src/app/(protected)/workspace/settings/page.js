import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Building2Icon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace, getWorkspaceRole } from "@/lib/workspaces";
import { WorkspaceSettingsForm } from "@/components/workspace-settings-form";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function WorkspaceSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/workspace/settings");
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
                <Building2Icon />
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

  const [role, { data: policy }, { count: memberCount }] = await Promise.all([
    getWorkspaceRole(supabase, user, workspace.id),
    supabase
      .from("approval_policies")
      .select("*")
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    // Accepted members only — a pending invite cannot approve anything, so it
    // must not count towards a satisfiable approval threshold.
    supabase
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .not("accepted_at", "is", null),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Workspace settings</h1>
        <p className="text-sm text-muted-foreground">
          Name, and how many people must sign off before money moves.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <WorkspaceSettingsForm
          workspace={workspace}
          policy={policy}
          memberCount={memberCount ?? 1}
          canManage={["owner", "admin"].includes(role ?? "")}
        />
      </div>
    </div>
  );
}
