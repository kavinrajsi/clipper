import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

const PROTECTED_PATH_PREFIXES = [
  "/onboarding",
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
  "/reviews",
  "/messages",
  "/submissions",
  "/studio",
];

// Everything under /api is gated too, so a route that forgets getUser() is not
// wide open. These are the exceptions: none of them is called by a signed-in
// browser, and each authenticates itself. Proxying them would redirect every
// delivery to /login and lose it silently.
//
//   /api/payments/webhook            Razorpay, HMAC signature
//   /api/ai/webhook/*                Sarvam, shared token (constant-time)
//   /api/cron/*                      Vercel Cron, CRON_SECRET bearer
//   /api/connectors/youtube/callback Google, carries the OAuth state cookie
//
// Adding a route with a non-session caller? It goes here, and in AGENTS.md.
const PUBLIC_API_PREFIXES = [
  "/api/payments/webhook",
  "/api/ai/webhook",
  "/api/cron",
  "/api/connectors/youtube/callback",
];

// API paths a browser navigates to rather than fetches. These want the login
// page, not a 401 body nobody will ever see.
const BROWSER_API_PATHS = ["/api/connectors/youtube/start"];

// Prefix match on whole segments. A bare startsWith() made /campaigns-foo match
// /campaigns, which is the fail-safe direction but still wrong.
function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

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

  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const isPublicApi = PUBLIC_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
  const isProtected =
    (isApi && !isPublicApi) ||
    PROTECTED_PATH_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));

  if (!data?.claims && isProtected) {
    // A 302 to a login page is not something fetch() can act on, so API callers
    // get a status they can branch on instead. This drops the refreshed cookies
    // setAll() put on supabaseResponse — deliberate: there was no valid session
    // to refresh, which is why we are here.
    if (isApi && !BROWSER_API_PATHS.includes(pathname)) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
