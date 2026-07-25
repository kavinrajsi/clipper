const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

export function extractYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1) || null;
    }
    if (parsed.searchParams.has("v")) {
      return parsed.searchParams.get("v");
    }
    const shortsMatch = parsed.pathname.match(/\/shorts\/([^/]+)/);
    if (shortsMatch) {
      return shortsMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function getGoogleAuthUrl(state, redirectUri) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForTokens(code, redirectUri) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${await response.text()}`);
  }

  return response.json();
}

export async function refreshAccessToken(refreshToken) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${await response.text()}`);
  }

  return response.json();
}

async function googleGet(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google API request failed (${url}): ${await response.text()}`);
  }

  return response.json();
}

export async function fetchChannel(accessToken) {
  const url = `${YOUTUBE_API_URL}/channels?part=snippet,statistics,contentDetails&mine=true`;
  const data = await googleGet(url, accessToken);
  const channel = data.items?.[0];
  if (!channel) return null;

  return {
    channelId: channel.id,
    title: channel.snippet?.title,
    description: channel.snippet?.description ?? "",
    thumbnailUrl: channel.snippet?.thumbnails?.default?.url,
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads,
    statistics: channel.statistics,
  };
}

export async function fetchAllUploadedVideos(accessToken, uploadsPlaylistId) {
  const videoIds = [];
  let pageToken = "";

  do {
    const url = new URL(`${YOUTUBE_API_URL}/playlistItems`);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("playlistId", uploadsPlaylistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await googleGet(url.toString(), accessToken);
    for (const item of data.items ?? []) {
      videoIds.push(item.contentDetails.videoId);
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  const videos = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `${YOUTUBE_API_URL}/videos?part=snippet,statistics&id=${batch.join(",")}`;
    const data = await googleGet(url, accessToken);

    for (const video of data.items ?? []) {
      videos.push({
        videoId: video.id,
        title: video.snippet?.title,
        thumbnailUrl: video.snippet?.thumbnails?.default?.url,
        publishedAt: video.snippet?.publishedAt,
        viewCount: video.statistics?.viewCount != null ? Number(video.statistics.viewCount) : null,
        likeCount: video.statistics?.likeCount != null ? Number(video.statistics.likeCount) : null,
        commentCount:
          video.statistics?.commentCount != null ? Number(video.statistics.commentCount) : null,
      });
    }
  }

  return videos;
}

export async function fetchRecentActivities(accessToken, maxPages = 3) {
  const activities = [];
  let pageToken = "";
  let page = 0;

  do {
    const url = new URL(`${YOUTUBE_API_URL}/activities`);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await googleGet(url.toString(), accessToken);
    for (const item of data.items ?? []) {
      const type = item.snippet?.type;
      const upload = item.contentDetails?.upload;

      activities.push({
        activityId: item.id,
        type,
        title: item.snippet?.title,
        description: item.snippet?.description ?? "",
        thumbnailUrl: item.snippet?.thumbnails?.default?.url,
        videoId: type === "upload" ? upload?.videoId ?? null : null,
        publishedAt: item.snippet?.publishedAt,
      });
    }

    pageToken = data.nextPageToken ?? "";
    page += 1;
  } while (pageToken && page < maxPages);

  return activities;
}

export async function fetchChannelAnalytics(accessToken, startDate, endDate) {
  const url = new URL(YOUTUBE_ANALYTICS_URL);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set(
    "metrics",
    "views,estimatedMinutesWatched,subscribersGained,likes,comments,shares"
  );
  url.searchParams.set("dimensions", "day");

  const data = await googleGet(url.toString(), accessToken);
  const headers = (data.columnHeaders ?? []).map((header) => header.name);

  return (data.rows ?? []).map((row) => {
    const entry = {};
    headers.forEach((name, index) => {
      entry[name] = row[index];
    });
    return entry;
  });
}
