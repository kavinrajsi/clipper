import { NextResponse } from "next/server";
import { hasAppRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
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

    // Keep the tier that was just proved. Nulling it here used to clear
    // payout_multiplier, and approve/route.js reads `?? 1.0` — so completing
    // bio-code verification silently paid the creator at the full rate instead
    // of the 0.75 the tier exists to apply. It also left the badge and the
    // connector card's "verified" branch permanently unreachable.
    // Tier + multiplier are guarded columns — service-role client, reached only
    // after the bio code was confirmed against the live channel description.
    const { error: updateError } = await createAdminClient()
      .from("youtube_connections")
      .update({
        verification_method: "bio_code",
        verification_code: null, // consumed
        verified_at: new Date().toISOString(),
        payout_multiplier: 0.75,
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
