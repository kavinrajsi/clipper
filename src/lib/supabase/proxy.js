import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

const PROTECTED_PATH_PREFIXES = [
  "/profile",
  "/connectors",
  "/dashboard",
  "/analytics",
  "/clipper-profile",
  "/campaigns",
  "/admin",
  "/payout-account",
  "/brand-profile",
  "/clippers",
  "/saved",
  "/invitations",
  "/notifications",
  "/workspace",
  "/messages",
];

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request });

  // With Fluid compute, don't put this client in a global variable.
  // Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and getClaims().
  // getClaims() validates the JWT and refreshes the session cookie —
  // skipping it can cause users to be randomly logged out.
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!data?.claims && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
