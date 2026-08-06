import { NextResponse } from "next/server";
import { hasAppRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAllUploadedVideos,
  fetchChannel,
  fetchChannelAnalytics,
  fetchRecentActivities,
  refreshAccessToken,
} from "@/lib/youtube";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// Postgres rejects an upsert whose batch contains two rows with the same
// conflict key ("ON CONFLICT DO UPDATE command cannot affect row a second
// time", 21000). YouTube's paginated list endpoints can return the same item
// on more than one page, so collapse duplicates before sending the batch.
function dedupeBy(rows, keyFn) {
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(keyFn(row), row);
  }
  return [...byKey.values()];
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // /connectors is clipper-only via requireRole. The API has to agree, or a
  // brand account can drive the whole flow straight past the hidden UI.
  if (!(await hasAppRole(supabase, user, "clipper"))) {
    return NextResponse.json(
      { error: "Only creator accounts can connect a channel." },
      { status: 403 }
    );
  }

  const { data: connection, error: connectionError } = await supabase
    .from("youtube_connections")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (connectionError || !connection) {
    return NextResponse.json({ error: "No YouTube connection found" }, { status: 404 });
  }

  // Reached only after the RLS-scoped read above proved this caller owns the
  // connection. Used for the columns a guard trigger reserves to the pipeline;
  // every row written through it is pinned to user.id.
  const pipeline = createAdminClient();

  try {
    let accessToken = connection.access_token;
    const isExpired =
      !connection.token_expires_at || new Date(connection.token_expires_at) <= new Date();

    if (isExpired) {
      const refreshed = await refreshAccessToken(connection.refresh_token);
      accessToken = refreshed.access_token;
      await supabase
        .from("youtube_connections")
        .update({
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        })
        .eq("user_id", user.id);
    }

    const channel = await fetchChannel(accessToken);
    if (!channel) throw new Error("Channel not found");

    const videos = channel.uploadsPlaylistId
      ? await fetchAllUploadedVideos(accessToken, channel.uploadsPlaylistId)
      : [];

    const videoRows = dedupeBy(
      videos.map((video) => ({
        user_id: user.id,
        video_id: video.videoId,
        title: video.title,
        thumbnail_url: video.thumbnailUrl,
        published_at: video.publishedAt,
        view_count: video.viewCount,
        like_count: video.likeCount,
        comment_count: video.commentCount,
        updated_at: new Date().toISOString(),
      })),
      (row) => row.video_id
    );

    // youtube_videos is YouTube's data, not the user's — and view_count is a
    // direct input to per-view payouts in approve/route.js. A guard trigger
    // blocks authenticated writes to the whole table, so the sync (the only
    // legitimate writer) goes through the service-role client. Every row is
    // pinned to user.id below, so this grants no cross-user reach.
    if (videoRows.length > 0) {
      const { error: videosError } = await pipeline
        .from("youtube_videos")
        .upsert(videoRows, { onConflict: "user_id,video_id" });
      if (videosError) throw videosError;
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const analytics = await fetchChannelAnalytics(
      accessToken,
      formatDate(startDate),
      formatDate(endDate)
    );

    const statsRows = dedupeBy(
      analytics.map((row) => ({
        user_id: user.id,
        date: row.day,
        views: row.views ?? null,
        estimated_minutes_watched: row.estimatedMinutesWatched ?? null,
        subscribers_gained: row.subscribersGained ?? null,
        likes: row.likes ?? null,
        comments: row.comments ?? null,
        shares: row.shares ?? null,
      })),
      (row) => row.date
    );

    if (statsRows.length > 0) {
      const { error: statsError } = await supabase
        .from("youtube_channel_stats_daily")
        .upsert(statsRows, { onConflict: "user_id,date" });
      if (statsError) throw statsError;
    }

    const activities = await fetchRecentActivities(accessToken);

    const activityRows = dedupeBy(
      activities.map((activity) => ({
        user_id: user.id,
        activity_id: activity.activityId,
        type: activity.type,
        title: activity.title,
        description: activity.description,
        thumbnail_url: activity.thumbnailUrl,
        video_id: activity.videoId,
        published_at: activity.publishedAt,
      })),
      (row) => row.activity_id
    );

    if (activityRows.length > 0) {
      const { error: activitiesError } = await supabase
        .from("youtube_activities")
        .upsert(activityRows, { onConflict: "user_id,activity_id" });
      if (activitiesError) throw activitiesError;
    }

    await supabase
      .from("youtube_connections")
      .update({
        channel_title: channel.title,
        channel_thumbnail_url: channel.thumbnailUrl,
        last_synced_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("YouTube sync failed", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
