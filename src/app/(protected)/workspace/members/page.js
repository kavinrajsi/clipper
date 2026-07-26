import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UsersRoundIcon } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace, getWorkspaceRole } from "@/lib/workspaces";
import { WorkspaceMembersManager } from "@/components/workspace-members-manager";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function WorkspaceMembersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/workspace/members");
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
                <UsersRoundIcon />
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

  const viewerRole = await getWorkspaceRole(supabase, user, workspace.id);

  const { data: memberRows } = await supabase
    .from("workspace_members")
    .select("user_id, role, accepted_at, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: true });

  const members = memberRows ?? [];
  const ids = members.map((m) => m.user_id);

  let profiles = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", ids);
    profiles = data ?? [];
  }
  const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));

  // Emails live only in auth.users. Owners and admins manage people by email,
  // so resolve them here with the service-role client — after the membership
  // check above, and only for members of this workspace.
  let emailById = {};
  if (["owner", "admin"].includes(viewerRole ?? "") && ids.length > 0) {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    emailById = Object.fromEntries(
      (data?.users ?? []).filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email])
    );
  }

  // Invites for people with no account yet. RLS already limits this to
  // owners/admins, so a member simply gets nothing back.
  const { data: inviteRows } = await supabase
    .from("workspace_invites")
    .select("*")
    .eq("workspace_id", workspace.id)
    .is("claimed_at", null)
    .order("created_at", { ascending: false });

  const withProfiles = members.map((member) => ({
    ...member,
    full_name: profileById[member.user_id]?.full_name,
    avatar_url: profileById[member.user_id]?.avatar_url,
    email: emailById[member.user_id],
  }));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground">
          Who can work on this workspace&apos;s campaigns, and what they&apos;re allowed to do.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <WorkspaceMembersManager
          workspace={workspace}
          members={withProfiles}
          invites={inviteRows ?? []}
          viewerId={user.id}
          viewerRole={viewerRole}
        />
      </div>
    </div>
  );
}
