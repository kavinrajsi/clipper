import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasAppRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { getGoogleAuthUrl } from "@/lib/youtube";

export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/connectors", request.url));
  }

  // A browser navigation, not a fetch() — so this mirrors what requireRole
  // does on /connectors rather than returning a 403 body nobody would see.
  if (!(await hasAppRole(supabase, user, "clipper"))) {
    return NextResponse.redirect(new URL("/campaigns", request.url));
  }

  const state = crypto.randomUUID();
  const redirectUri = new URL("/api/connectors/youtube/callback", request.url).toString();
  const authUrl = getGoogleAuthUrl(state, redirectUri);

  const cookieStore = await cookies();
  cookieStore.set("youtube_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(authUrl);
}
