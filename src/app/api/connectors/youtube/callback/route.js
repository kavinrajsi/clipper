import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, fetchChannel } from "@/lib/youtube";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("youtube_oauth_state")?.value;
  cookieStore.delete("youtube_oauth_state");

  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(`${origin}/connectors?error=youtube-auth-failed`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login?next=/connectors`);
  }

  try {
    const redirectUri = `${origin}/api/connectors/youtube/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const channel = await fetchChannel(tokens.access_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // channel_id is what choose-method verifies the "linked" tier against, so a
    // guard trigger reserves it to the pipeline. This is Google's answer to
    // fetchChannel() a few lines up, not anything the caller supplied, and the
    // row is pinned to the authenticated user.id.
    const { error } = await createAdminClient().from("youtube_connections").upsert(
      {
        user_id: user.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokenExpiresAt,
        channel_id: channel?.channelId ?? null,
        channel_title: channel?.title ?? null,
        channel_thumbnail_url: channel?.thumbnailUrl ?? null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;
  } catch (err) {
    console.error("YouTube connect failed", err);
    return NextResponse.redirect(`${origin}/connectors?error=youtube-auth-failed`);
  }

  return NextResponse.redirect(`${origin}/connectors?connected=youtube`);
}
