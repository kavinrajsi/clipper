import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const explicitNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const next = explicitNext?.startsWith("/")
        ? explicitNext
        : await getDefaultDestination(supabase, data.user.id);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-code-error`);
}

async function getDefaultDestination(supabase, userId) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  return profile?.role === "brand" ? "/campaigns" : "/dashboard";
}
