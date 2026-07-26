import { redirect } from "next/navigation";
import { MailOpenIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPendingWorkspaceInvites } from "@/lib/workspaces";
import { formatCampaignRate, formatDate } from "@/lib/format";
import { InvitationActions } from "@/components/invitation-actions";
import { WorkspaceInvitationActions } from "@/components/workspace-invitation-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

const STATUS_VARIANT = {
  sent: "secondary",
  viewed: "secondary",
  accepted: "default",
  declined: "destructive",
  expired: "outline",
};

export default async function InvitationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/invitations");
  }

  const { data: inviteRows } = await supabase
    .from("campaign_invites")
    .select("*")
    .eq("clipper_id", user.id)
    .order("created_at", { ascending: false });

  const invites = inviteRows ?? [];
  const workspaceInvites = await getPendingWorkspaceInvites(supabase, user);
  const campaignIds = invites.map((invite) => invite.campaign_id);

  // The "Invited clippers can view the campaign" policy is what makes this
  // readable — these campaigns are otherwise unlisted.
  let campaigns = [];
  let brandProfiles = [];
  if (campaignIds.length > 0) {
    const { data } = await supabase.from("campaigns").select("*").in("id", campaignIds);
    campaigns = data ?? [];

    const brandIds = [...new Set(campaigns.map((c) => c.brand_id))];
    if (brandIds.length > 0) {
      const { data: brands } = await supabase
        .from("brand_profiles")
        .select("user_id, company_name")
        .in("user_id", brandIds);
      brandProfiles = brands ?? [];
    }
  }

  const campaignById = Object.fromEntries(campaigns.map((c) => [c.id, c]));
  const brandById = Object.fromEntries(brandProfiles.map((b) => [b.user_id, b]));

  const pending = invites.filter((i) => ["sent", "viewed"].includes(i.status));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Invitations</h1>
        <p className="text-sm text-muted-foreground">
          Campaigns brands have invited you to directly. Accepting applies on your behalf.
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {workspaceInvites.map((invite) => (
          <Card key={invite.workspace_id}>
            <CardHeader>
              <CardTitle>{invite.workspace.name}</CardTitle>
              <CardDescription>
                You&apos;ve been invited to join this workspace as {invite.role}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkspaceInvitationActions workspaceId={invite.workspace_id} />
            </CardContent>
          </Card>
        ))}

        {invites.length === 0 && workspaceInvites.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailOpenIcon />
              </EmptyMedia>
              <EmptyTitle>No invitations yet</EmptyTitle>
              <EmptyDescription>
                Brands can invite you directly once your profile is published. A complete profile
                with clips makes that far more likely.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {invites.map((invite) => {
          const campaign = campaignById[invite.campaign_id];
          const isPending = pending.includes(invite);
          const expired = new Date(invite.expires_at) < new Date();

          return (
            <Card key={invite.id}>
              <CardHeader>
                <CardTitle>{campaign?.title ?? "Campaign unavailable"}</CardTitle>
                <CardDescription>
                  {brandById[campaign?.brand_id]?.company_name ?? "A brand"}
                  {campaign && ` · ${formatCampaignRate(campaign)}`}
                </CardDescription>
                <Badge variant={STATUS_VARIANT[invite.status] ?? "outline"}>
                  {expired && isPending ? "expired" : invite.status}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {invite.message && (
                  <p className="rounded-md bg-muted/50 p-3 text-sm">{invite.message}</p>
                )}
                {campaign?.description && (
                  <p className="text-sm text-muted-foreground">{campaign.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Invited {formatDate(invite.created_at, { style: "medium" })}
                  {isPending &&
                    !expired &&
                    ` · expires ${formatDate(invite.expires_at, { style: "medium" })}`}
                </p>
                {isPending && !expired && campaign && <InvitationActions invite={invite} />}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
