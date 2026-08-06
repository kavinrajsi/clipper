import { NextResponse } from "next/server";
import { hasAppRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchChannel, refreshAccessToken } from "@/lib/youtube";

function generateVerificationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `CLIP-${code}`;
}

export async function POST(request) {
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

  const { method } = await request.json();

  if (method !== "linked" && method !== "bio_code") {
    return NextResponse.json({ error: "Invalid method" }, { status: 400 });
  }

  const { data: connection } = await supabase
    .from("youtube_connections")
    .select("bio_code_confirmed_at, channel_id, access_token, refresh_token, token_expires_at")
    .eq("user_id", user.id)
    .single();

  // An .update() that matches no row is not an error, so without this the
  // route happily reported success for a user who had never connected at all.
  if (!connection) {
    return NextResponse.json({ error: "Connect a YouTube channel first." }, { status: 400 });
  }

  if (method === "bio_code" && connection.bio_code_confirmed_at) {
    return NextResponse.json(
      { error: "Bio-code verification already used — connect with OAuth instead." },
      { status: 400 }
    );
  }

  // "linked" is the full-rate tier, so it needs proof, not a claim. Previously
  // this branch stamped verified_at and a 1.0 multiplier on nothing but the
  // caller's say-so.
  //
  // Checking that channel_id and access_token merely EXIST is not enough: the
  // INSERT policy on youtube_connections lets a clipper write their own row
  // with any values they like, and every legitimately connected user has both
  // columns populated anyway — so that test admits everyone. The proof has to
  // be a live call: ask Google who this token belongs to, and require the
  // answer to match the channel on the row.
  if (method === "linked") {
    if (!connection.channel_id || !connection.refresh_token) {
      return NextResponse.json(
        { error: "Finish connecting your channel with Google before choosing this method." },
        { status: 400 }
      );
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
      if (!channel || channel.channelId !== connection.channel_id) {
        return NextResponse.json(
          { error: "We couldn't confirm that channel with Google. Reconnect and try again." },
          { status: 400 }
        );
      }
    } catch (err) {
      console.error("YouTube linked verification failed", err);
      return NextResponse.json(
        { error: "We couldn't reach YouTube to confirm your channel. Try again." },
        { status: 502 }
      );
    }
  }

  const update =
    method === "linked"
      ? {
          verification_method: "linked",
          payout_multiplier: 1.0,
          verification_code: null,
          verified_at: new Date().toISOString(),
        }
      : {
          verification_method: "bio_code",
          payout_multiplier: 0.75,
          verification_code: generateVerificationCode(),
          verified_at: null,
        };

  // The verification tier and payout_multiplier decide what this creator is
  // paid, so a guard trigger reserves them to the pipeline. Reached only after
  // the role check, the ownership-scoped read, and (for "linked") a live call
  // to Google confirming the channel.
  const { error } = await createAdminClient()
    .from("youtube_connections")
    .update(update)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save verification method" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
