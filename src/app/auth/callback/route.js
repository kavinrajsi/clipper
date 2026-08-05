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
      const next = await resolveDestination(supabase, data.user.id, explicitNext);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-code-error`);
}

async function resolveDestination(supabase, userId, explicitNext) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, role_chosen_at")
    .eq("id", userId)
    .single();

  // Overrides `next`, rather than sitting behind it. A proxy-set
  // next=/dashboard would otherwise skip the picker here and only meet it a
  // moment later via the protected layout's gate — one wasted round trip and a
  // page flash on the way.
  if (!profile?.role_chosen_at) return "/onboarding/role";

  if (explicitNext?.startsWith("/")) return explicitNext;
  return profile.role === "brand" ? "/campaigns" : "/dashboard";
}
