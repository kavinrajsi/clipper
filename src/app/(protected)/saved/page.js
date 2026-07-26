import Link from "next/link";
import { redirect } from "next/navigation";
import { BookmarkIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CampaignCard } from "@/components/campaign-card";
import { ClipperDirectoryCard } from "@/components/clipper-directory-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

async function getSavedCreators(supabase, userId) {
  const { data: saves } = await supabase
    .from("saved_creators")
    .select("creator_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const ids = (saves ?? []).map((s) => s.creator_id);
  if (ids.length === 0) return [];

  const [{ data: profiles }, { data: accounts }, { data: verifications }, { data: stats }] =
    await Promise.all([
      supabase.from("clipper_profiles").select("*").in("user_id", ids),
      supabase.from("profiles").select("id, full_name, avatar_url").in("id", ids),
      supabase.from("creator_verification").select("*").in("user_id", ids),
      supabase.from("creator_stats").select("*").in("user_id", ids),
    ]);

  const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p]));
  const accountById = Object.fromEntries((accounts ?? []).map((a) => [a.id, a]));
  const verificationById = Object.fromEntries((verifications ?? []).map((v) => [v.user_id, v]));
  const statsById = Object.fromEntries((stats ?? []).map((s) => [s.user_id, s]));

  // Preserve save order, and drop any creator whose profile is no longer
  // readable — unpublished since saving, or the account was deleted.
  return ids
    .filter((id) => profileById[id])
    .map((id) => ({
      profile: profileById[id],
      account: accountById[id],
      verification: verificationById[id],
      stats: statsById[id],
    }));
}

async function getSavedCampaigns(supabase, userId) {
  const { data: saves } = await supabase
    .from("saved_campaigns")
    .select("campaign_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const ids = (saves ?? []).map((s) => s.campaign_id);
  if (ids.length === 0) return { campaigns: [], applicationByCampaign: {} };

  const [{ data: campaigns }, { data: applications }] = await Promise.all([
    supabase.from("campaigns").select("*").in("id", ids),
    supabase
      .from("campaign_applications")
      .select("campaign_id, status")
      .eq("clipper_id", userId)
      .in("campaign_id", ids),
  ]);

  const byId = Object.fromEntries((campaigns ?? []).map((c) => [c.id, c]));
  const applicationByCampaign = Object.fromEntries(
    (applications ?? []).map((a) => [a.campaign_id, a.status])
  );

  return { campaigns: ids.filter((id) => byId[id]).map((id) => byId[id]), applicationByCampaign };
}

export default async function SavedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/saved");
  }

  const [creators, { campaigns, applicationByCampaign }, { data: portfolioItems }] =
    await Promise.all([
      getSavedCreators(supabase, user.id),
      getSavedCampaigns(supabase, user.id),
      // Same portfolio the proposal form offers on /campaigns.
      supabase
        .from("portfolio_items")
        .select("id, title, thumbnail_url, view_count")
        .eq("user_id", user.id)
        .order("position", { ascending: true }),
    ]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-muted-foreground">
          Creators and campaigns you&apos;ve bookmarked. Only you can see this.
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <Tabs defaultValue="creators">
          <TabsList>
            <TabsTrigger value="creators">Creators ({creators.length})</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns ({campaigns.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="creators" className="mt-4">
            {creators.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BookmarkIcon />
                  </EmptyMedia>
                  <EmptyTitle>No saved creators</EmptyTitle>
                  <EmptyDescription>
                    Bookmark creators while browsing so you can find them when you post a campaign.
                  </EmptyDescription>
                </EmptyHeader>
                <Button nativeButton={false} render={<Link href="/discover" />}>
                  Find creators
                </Button>
              </Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {creators.map(({ profile, account, verification, stats }) => (
                  <ClipperDirectoryCard
                    key={profile.user_id}
                    clipperProfile={profile}
                    profile={account}
                    verification={verification}
                    stats={stats}
                    saved
                    isAuthenticated
                    showSave
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="campaigns" className="mt-4">
            {campaigns.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BookmarkIcon />
                  </EmptyMedia>
                  <EmptyTitle>No saved campaigns</EmptyTitle>
                  <EmptyDescription>
                    Save campaigns you want to come back to before applying.
                  </EmptyDescription>
                </EmptyHeader>
                <Button nativeButton={false} render={<Link href="/campaigns" />}>
                  Browse campaigns
                </Button>
              </Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {campaigns.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    role="clipper"
                    applicationStatus={applicationByCampaign[campaign.id]}
                    saved
                    portfolioItems={portfolioItems ?? []}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
