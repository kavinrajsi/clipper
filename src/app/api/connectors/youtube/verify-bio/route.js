import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchChannel, refreshAccessToken } from "@/lib/youtube";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: connection, error: connectionError } = await supabase
    .from("youtube_connections")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (connectionError || !connection) {
    return NextResponse.json({ error: "No YouTube connection found" }, { status: 404 });
  }

  if (connection.verification_method !== "bio_code" || !connection.verification_code) {
    return NextResponse.json({ error: "No pending bio-code verification" }, { status: 400 });
  }

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
    const found = Boolean(channel?.description?.includes(connection.verification_code));

    if (!found) {
      return NextResponse.json({ verified: false });
    }

    const { error: updateError } = await supabase
      .from("youtube_connections")
      .update({
        verification_method: null,
        verification_code: null,
        verified_at: null,
        payout_multiplier: null,
        bio_code_confirmed_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error("YouTube bio verification failed", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
