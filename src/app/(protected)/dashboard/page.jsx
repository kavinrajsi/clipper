import { AnalyticsChart } from "@/components/analytics-chart"
import { DashboardSummaryCards } from "@/components/dashboard-summary-cards"
import { MyApplicationsTable } from "@/components/my-applications-table"
import { createClient } from "@/lib/supabase/server"

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: stats } = await supabase
    .from("youtube_channel_stats_daily")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: true })

  const { count: videosSynced } = await supabase
    .from("youtube_videos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)

  const { count: pendingApplications } = await supabase
    .from("campaign_applications")
    .select("*", { count: "exact", head: true })
    .eq("clipper_id", user.id)
    .eq("status", "pending")

  const { count: approvedCampaigns } = await supabase
    .from("campaign_applications")
    .select("*", { count: "exact", head: true })
    .eq("clipper_id", user.id)
    .eq("status", "approved")

  const { data: applications } = await supabase
    .from("campaign_applications")
    .select(
      "id, status, created_at, campaign:campaigns(title, payout_structure, payout_rate), submission:campaign_submissions(status)"
    )
    .eq("clipper_id", user.id)
    .order("created_at", { ascending: false })

  const statsRows = stats ?? []
  const totalViews = statsRows.reduce((sum, row) => sum + (row.views ?? 0), 0)

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <DashboardSummaryCards
          totalViews={totalViews}
          videosSynced={videosSynced ?? 0}
          pendingApplications={pendingApplications ?? 0}
          approvedCampaigns={approvedCampaigns ?? 0}
        />
        <div className="px-4 lg:px-6">
          <AnalyticsChart
            title="Views"
            description="Daily views from your connected channel"
            data={statsRows}
            dataKey="views"
          />
        </div>
        <MyApplicationsTable applications={applications ?? []} />
      </div>
    </div>
  );
}
