import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceRole } from "@/lib/workspaces";
import { CampaignApplicationsList } from "@/components/campaign-applications-list";
import { CampaignInvitesManager } from "@/components/campaign-invites-manager";
import { CampaignMilestonesManager } from "@/components/campaign-milestones-manager";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function CampaignDetailPage({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/campaigns/${id}`);
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();

  const workspaceRole = campaign
    ? await getWorkspaceRole(supabase, user, campaign.workspace_id)
    : null;

  if (!campaign || !workspaceRole) {
    redirect("/campaigns");
  }

  const { data: applications } = await supabase
    .from("campaign_applications")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  const clipperIds = [...new Set((applications ?? []).map((application) => application.clipper_id))];
  const applicationIds = (applications ?? []).map((application) => application.id);

  let clipperProfiles = [];
  if (clipperIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", clipperIds);
    clipperProfiles = data ?? [];
  }

  let submissions = [];
  let payouts = [];
  if (applicationIds.length > 0) {
    const { data: submissionsData } = await supabase
      .from("campaign_submissions")
      .select("*")
      .in("application_id", applicationIds)
      .order("created_at", { ascending: true });
    submissions = submissionsData ?? [];

    const { data: payoutsData } = await supabase
      .from("campaign_payouts")
      .select("*")
      .in("application_id", applicationIds);
    payouts = payoutsData ?? [];
  }

  const profileById = Object.fromEntries(clipperProfiles.map((profile) => [profile.id, profile]));
  const submissionByApplication = Object.fromEntries(
    submissions.map((submission) => [submission.application_id, submission])
  );
  const payoutByApplication = Object.fromEntries(
    payouts.map((payout) => [payout.application_id, payout])
  );

  // Portfolio clips attached to each proposal. The join is done here rather
  // than nested in the applications query because proposal_attachments has no
  // FK PostgREST can follow to portfolio_items' owner.
  let attachmentsByApplication = {};
  if (applicationIds.length > 0) {
    const { data: attachmentRows } = await supabase
      .from("proposal_attachments")
      .select("id, application_id, portfolio_item_id")
      .in("application_id", applicationIds);

    const itemIds = [...new Set((attachmentRows ?? []).map((row) => row.portfolio_item_id))];
    let items = [];
    if (itemIds.length > 0) {
      const { data } = await supabase
        .from("portfolio_items")
        .select("id, title, thumbnail_url, video_url, view_count")
        .in("id", itemIds);
      items = data ?? [];
    }
    const itemById = Object.fromEntries(items.map((item) => [item.id, item]));

    attachmentsByApplication = (attachmentRows ?? []).reduce((acc, row) => {
      const item = itemById[row.portfolio_item_id];
      if (!item) return acc;
      (acc[row.application_id] ??= []).push(item);
      return acc;
    }, {});
  }

  const applicationsWithClipper = (applications ?? []).map((application) => ({
    ...application,
    clipper: profileById[application.clipper_id],
    submission: submissionByApplication[application.id],
    payout: payoutByApplication[application.id],
    attachments: attachmentsByApplication[application.id] ?? [],
  }));

  // Invites, plus the pool of creators who could be invited. Saved creators
  // come first — that is what saving them was for.
  const { data: inviteRows } = await supabase
    .from("campaign_invites")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: false });

  const { data: savedRows } = await supabase
    .from("saved_creators")
    .select("creator_id")
    .eq("user_id", user.id);
  const savedIds = new Set((savedRows ?? []).map((row) => row.creator_id));

  const { data: publishedProfiles } = await supabase
    .from("clipper_profiles")
    .select("user_id, handle, headline")
    .eq("is_public", true)
    .limit(100);

  const creatorIds = [
    ...new Set([
      ...(inviteRows ?? []).map((row) => row.clipper_id),
      ...(publishedProfiles ?? []).map((row) => row.user_id),
      ...savedIds,
    ]),
  ];

  let creatorAccounts = [];
  if (creatorIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", creatorIds);
    creatorAccounts = data ?? [];
  }
  const accountById = Object.fromEntries(creatorAccounts.map((a) => [a.id, a]));
  const publicById = Object.fromEntries((publishedProfiles ?? []).map((p) => [p.user_id, p]));

  const invites = (inviteRows ?? []).map((invite) => ({
    ...invite,
    full_name: accountById[invite.clipper_id]?.full_name,
    avatar_url: accountById[invite.clipper_id]?.avatar_url,
    handle: publicById[invite.clipper_id]?.handle,
  }));

  const { data: milestoneRows } = await supabase
    .from("campaign_milestones")
    .select("*")
    .eq("campaign_id", id)
    .order("position", { ascending: true });

  const milestones = milestoneRows ?? [];

  // campaign_payouts has no campaign_id, so scope by milestone. Without the
  // `in` filter this reads every milestone payout the viewer can see, across
  // every campaign, and grows with the account.
  let milestonePayouts = [];
  if (milestones.length > 0) {
    const { data } = await supabase
      .from("campaign_payouts")
      .select("id, milestone_id, status")
      .in(
        "milestone_id",
        milestones.map((m) => m.id)
      );
    milestonePayouts = data ?? [];
  }

  const candidates = (publishedProfiles ?? [])
    .map((profile) => ({
      user_id: profile.user_id,
      handle: profile.handle,
      headline: profile.headline,
      full_name: accountById[profile.user_id]?.full_name,
      avatar_url: accountById[profile.user_id]?.avatar_url,
      saved: savedIds.has(profile.user_id),
    }))
    .sort((a, b) => Number(b.saved) - Number(a.saved));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{campaign.title}</h1>
          <Badge variant="outline">{campaign.status}</Badge>
        </div>
        {campaign.description && (
          <p className="mt-1 text-sm text-muted-foreground">{campaign.description}</p>
        )}
      </div>
      <Tabs defaultValue="applicants">
        <TabsList>
          <TabsTrigger value="applicants">
            Applicants ({applicationsWithClipper.length})
          </TabsTrigger>
          <TabsTrigger value="invited">Invited ({invites.length})</TabsTrigger>
          <TabsTrigger value="milestones">
            Milestones ({milestones.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="applicants" className="mt-4">
          <CampaignApplicationsList applications={applicationsWithClipper} />
        </TabsContent>
        <TabsContent value="invited" className="mt-4">
          <CampaignInvitesManager
            campaign={campaign}
            invites={invites}
            candidates={candidates}
          />
        </TabsContent>
        <TabsContent value="milestones" className="mt-4">
          <CampaignMilestonesManager
            campaign={campaign}
            milestones={milestones}
            payouts={milestonePayouts}
            canManage={Boolean(workspaceRole)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
