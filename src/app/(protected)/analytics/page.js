import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin";
import { requireRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ActivityFeed } from "@/components/activity-feed";
import { AnalyticsChart } from "@/components/analytics-chart";
import { AnalyticsSummaryCards } from "@/components/analytics-summary-cards";
import { VideoAnalyticsTable } from "@/components/video-analytics-table";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/analytics");
  }

  if (!isSuperAdmin(user)) {
    await requireRole(supabase, user, "clipper", "/campaigns");
  }

  const { data: stats } = await supabase
    .from("youtube_channel_stats_daily")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: true });

  const { data: videos } = await supabase
    .from("youtube_videos")
    .select("*")
    .eq("user_id", user.id)
    .order("view_count", { ascending: false });

  const { data: activities } = await supabase
    .from("youtube_activities")
    .select("*")
    .eq("user_id", user.id)
    .order("published_at", { ascending: false })
    .limit(20);

  const statsRows = stats ?? [];
  const videoRows = videos ?? [];
  const activityRows = activities ?? [];

  const totals = statsRows.reduce(
    (acc, row) => ({
      views: acc.views + (row.views ?? 0),
      minutesWatched: acc.minutesWatched + (row.estimated_minutes_watched ?? 0),
      subscribersGained: acc.subscribersGained + (row.subscribers_gained ?? 0),
      engagement: acc.engagement + (row.likes ?? 0) + (row.comments ?? 0),
    }),
    { views: 0, minutesWatched: 0, subscribersGained: 0, engagement: 0 }
  );

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <AnalyticsSummaryCards
          totalViews={totals.views}
          watchTimeHours={Math.round(totals.minutesWatched / 60)}
          subscribersGained={totals.subscribersGained}
          engagement={totals.engagement}
        />
        <div className="grid gap-4 px-4 lg:grid-cols-3 lg:px-6">
          <AnalyticsChart
            title="Views"
            description="Daily views"
            data={statsRows}
            dataKey="views"
          />
          <AnalyticsChart
            title="Watch Time"
            description="Estimated minutes watched"
            data={statsRows}
            dataKey="estimated_minutes_watched"
          />
          <AnalyticsChart
            title="Subscribers Gained"
            description="Daily subscriber growth"
            data={statsRows}
            dataKey="subscribers_gained"
          />
        </div>
        <VideoAnalyticsTable data={videoRows} />
        <ActivityFeed activities={activityRows} />
      </div>
    </div>
  );
}
