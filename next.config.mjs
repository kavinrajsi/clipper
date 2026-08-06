/** @type {import('next').NextConfig} */

// Third-party origins this app genuinely needs. Kept as named lists so a future
// reader can tell WHY each one is here rather than guessing from a long string.
const RAZORPAY = ["https://checkout.razorpay.com", "https://api.razorpay.com"];
const YOUTUBE = ["https://www.youtube.com", "https://s.ytimg.com"];

// Supabase is per-project, so derive it rather than hardcoding a ref. Falls back
// to the wildcard when the env var is absent (CI, a bare `next build`).
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "https://*.supabase.co";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  `default-src 'self'`,
  // 'unsafe-inline' is required until Next's inline bootstrap runs off a nonce,
  // which needs the CSP generated per-request in the proxy. 'unsafe-eval' is
  // dev-only (React Refresh).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${[...RAZORPAY, ...YOUTUBE].join(" ")}`,
  `style-src 'self' 'unsafe-inline'`,
  // Avatars and video thumbnails come from Google/YouTube/Supabase Storage, and
  // portfolio thumbnails are user-supplied (constrained to http(s) by
  // 20260805173445). `https:` rather than an allowlist we would silently outgrow.
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_ORIGIN.replace("https://", "wss://")} ${RAZORPAY.join(" ")}`,
  // The YouTube player iframe and the Razorpay checkout iframe.
  `frame-src ${[...YOUTUBE, ...RAZORPAY].join(" ")}`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
].join("; ");

const nextConfig = {
  reactCompiler: true,

  // There were no security headers at all: no CSP, X-Frame-Options,
  // X-Content-Type-Options, Referrer-Policy or HSTS. The admin panel and the
  // payment-funding UI were both framable.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // CSP ships Report-Only first. This app loads the Razorpay checkout
          // script and the YouTube IFrame API at runtime, and an enforcing
          // policy that is even slightly wrong breaks payments — worse than the
          // clickjacking it prevents. Watch reports, then rename this key to
          // `Content-Security-Policy` once it is quiet.
          { key: "Content-Security-Policy-Report-Only", value: csp },

          // Safe to enforce immediately, and these close the clickjacking gap
          // on their own, independently of the CSP rollout above.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
