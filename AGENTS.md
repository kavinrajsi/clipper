<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Clipper — project notes for agents

A marketplace connecting brands (post campaigns) and clippers (apply, submit clips, get paid). Brands fund campaigns via Razorpay; clippers connect a YouTube channel, apply to campaigns, submit a video once approved, and get paid once the brand approves the submission.

This section is a snapshot taken by reading the live codebase and the live Supabase project directly — this repo has had schema and code changes made outside of any single session's edits, so **re-verify against the actual files/DB before relying on specifics here**, especially anything that sounds like it could have changed (route guards, table columns, which tab shows what).

## Framework gotchas actually hit in this codebase

- **`proxy.js`, not `middleware.ts`.** Next.js 16 renamed the convention. `src/proxy.js` is the root proxy; session refresh logic lives in `src/lib/supabase/proxy.js`.
- **shadcn here is base-ui, not Radix** (`components.json` → `"style": "base-nova"`). Composition uses the `render` prop, not `asChild`. `Button` specifically needs `nativeButton={false}` when its `render` target isn't a real `<button>` (e.g. wrapping a `<Link>`) — omitting it throws a runtime warning/error. Both of these caused real bugs earlier in the build; don't reach for Radix patterns from memory.
- Dates are formatted `en-IN` (day-first), currency `en-IN`/INR, throughout — not `en-US`.

## Route groups

- `src/app/(app)/` — public pages (`/`, the marketing home page), wrapped in a plain `Header` (`src/components/header.jsx`) that shows Login/Sign up or the account dropdown.
- `src/app/(protected)/` — authenticated app shell (`src/components/app-sidebar.jsx` + `src/components/site-header.jsx`), role-branched nav. All routes here go through `src/lib/supabase/proxy.js`'s `PROTECTED_PATH_PREFIXES` list (auth required) — **and add any new protected route to that list**, it's not automatic.
- `src/app/(legal)/` — static content pages sharing one simple layout (`privacy`, `terms`, `clipper-terms`, `faq`, `support`) — reused for FAQ/Support despite the folder name; that's a deliberate naming shortcut, not a mistake.
- Route group folder names never affect the URL — they're purely organizational.

## Auth and roles

- **Google OAuth only** — there is no email/password path (it existed earlier in this project's history and was removed; `src/components/login-form.jsx` is Google-only now).
- `profiles.role` is `'clipper'` or `'brand'`, defaults to `'clipper'` on signup, switchable anytime from `/profile`. It is a business-role flag, not a permissions system by itself.
- **Route-level role gating exists** via `src/lib/roles.js`'s `requireRole(supabase, user, role, redirectTo)` — called from clipper-only pages (`/connectors`, `/dashboard`, `/payout-account`, `/clipper-profile`, `/analytics`) to redirect non-clippers to `/campaigns`. It's asymmetric: brand-only pages (`/brand-profile`, `/clippers`) currently have **no** route-level guard, only nav-hiding in `app-sidebar.jsx` — a real gap, not a design choice, if you're touching that area.
- **Super admin is a separate axis from role**, not a database value: `src/lib/admin.js`'s `isSuperAdmin(user)` compares `user.email` to the `SUPER_ADMIN_EMAIL` env var. It's checked ad hoc in individual pages/routes (often as a bypass for the `requireRole` checks above) rather than through a shared layout gate — grep for `isSuperAdmin` before assuming where it does or doesn't apply.

## RLS patterns in use

Every table has RLS enabled. Three patterns recur — match one of them for new tables rather than inventing a fourth:

1. **Owner-only** (`profiles`, `clipper_profiles`, `clipper_payout_accounts`, `youtube_*`, `brand_profiles` writes): `to authenticated using ((select auth.uid()) = user_id)`, same shape for insert/update.
2. **Cross-user via `exists()` subquery** (a brand reading applications/submissions/payouts on campaigns they own; a brand or clipper reading the other's basic identity): e.g. `exists (select 1 from campaigns c where c.id = campaign_id and c.brand_id = (select auth.uid()))`. `profiles` itself has a blanket `using (true)` select policy (full_name/avatar_url aren't sensitive) after an earlier bug where the owner-only-only policy silently blocked every cross-user profile lookup.
3. **Service-role bypass** (`src/lib/supabase/admin.js`'s `createAdminClient()`) — used only for `/admin` and the payment routes that need to read a *different* user's `clipper_payout_accounts`/`youtube_videos` before creating a Razorpay transfer. Every route using it verifies the caller's ownership of the relevant row via the normal RLS-scoped client **first**, then switches to the admin client only for the specific cross-user reads/writes it actually needs. Never expose this client to a `"use client"` file.

`campaign_payouts` has no client-side insert/update policy at all by design — every write there corresponds to a real Razorpay API call and only happens through the admin client.

## Payments (Razorpay)

Uses **Razorpay Route** — the marketplace split-payment product (`account`/linked-account + `transfer` with `on_hold`). Note: Razorpay also has a product literally called "Escrow" (RazorpayX Escrow Plus) — that's for lending/co-lending pooled funds, unrelated, don't confuse the two. **Route is not currently enabled on the account — see the warning below before touching payout code.**

Flow: brand creates a campaign → funds the full budget via Razorpay Checkout (`src/lib/razorpay-checkout.js` client-side, `/api/payments/campaigns/[id]/fund` + `/verify` server-side, signature-verified before the campaign activates) → clipper applies → brand approves the application → clipper submits a video (`campaign_submissions`) → brand approves the submission, which computes the payout (flat fee, or view-count × CPM using `youtube_videos.view_count` if synced, multiplied by the clipper's `youtube_connections.payout_multiplier` verification-tier discount), checks it against the campaign's remaining budget, and creates a held Razorpay transfer → brand releases the hold (`/api/payments/payouts/[id]/release`).

### ⚠ Route is NOT enabled on the Razorpay account — the payout half cannot run

Probed directly with the test keys in `.env.local` on 2026-07-26. **The keys are real and auth succeeds** — an earlier version of this file claimed every call 401s on placeholder keys, which is wrong. What actually fails is the Route product:

| Endpoint | Result |
|---|---|
| `GET /v1/payments`, `GET /v1/settlements` | **200** — real captured payment + settlement returned |
| `GET /v1/refunds`, `GET /v1/payments/{id}/refunds` | **200** — refunds are usable |
| `GET /v2/accounts` (linked accounts) | **404** `no Route matched with those values` |
| `GET`/`POST /v1/transfers` (direct transfers) | **400** `The requested URL was not found on the server` |
| `GET`/`POST /v1/payments/{id}/transfers` | **400** same |
| `GET /v1/payouts` (RazorpayX) | **400** `Access to requested resource not available` |

Consequences for anyone working in this area:

- **Campaign funding works** (orders/payments/checkout are core API).
- **`createLinkedAccount()` and `createHeldTransfer()` in `src/lib/razorpay.js` target endpoints that 400 on this account.** Clipper payout-account onboarding, held transfers, and releases have never been able to succeed. Don't debug that code assuming it once worked.
- **Refunds DO work** — core API, unaffected. Partial refunds are supported and multiple partials are allowed as long as the sum stays within the captured amount. This is currently the only working way to move money back out of the platform account.
- **RazorpayX Payouts is also unavailable**, but note the different error shape: Route returns "URL not found" (product not routed), RazorpayX returns "Access to requested resource not available" (endpoint exists, not authorised).

Fixing this is a support request to Razorpay to enable Route on test + live, not a code change. Direct Transfers (`POST /v1/transfers`) is *separately* on-demand and should be asked for in the same request — see `docs/product/08-monetisation.md`.

## Schema reference (live project, not local files — see below)

- **`profiles`** — `role` (`clipper`/`brand`), `full_name`, `avatar_url`.
- **YouTube connector**: `youtube_connections` (one per clipper — OAuth tokens, `verification_method`/`verification_code`/`verified_at`/`bio_code_confirmed_at`/`payout_multiplier` for the linked-vs-bio-code verification tiers), `youtube_videos`, `youtube_channel_stats_daily`, `youtube_activities`.
- **Marketplace**: `clipper_profiles`, `brand_profiles`, `campaigns` (includes `razorpay_order_id`/`razorpay_payment_id`/`funding_status`), `campaign_applications`, `campaign_submissions`, `campaign_payouts`.
- **Payouts**: `clipper_payout_accounts` — Razorpay linked-account details, including PAN and bank account number in plain columns (no column-level encryption — a real hardening gap, not an oversight nobody noticed).

## Known gaps / deliberately deferred

- Google OAuth signup skips any role picker — always defaults to `clipper`; changing role happens on `/profile` afterward.
- No brand-facing billing/spend-history page (aggregate spend across campaigns).
- Cancelling a funded campaign doesn't refund or reconcile the held Razorpay funds. Nor does *normal completion* — a campaign funded at ₹100,000 that pays out ₹60,000 leaves ₹40,000 in the platform account with no code path to return it. Underspend is the normal case for per-view campaigns, not an edge case. The Refunds API is available and supports partial refunds, so this is buildable today; it just isn't built.
- Per-view payouts depend on the clipper having synced the submitted video via Connectors — if it's not in `youtube_videos`, the payout falls back to a submission-time snapshot (`view_count_at_submission`), which may be `null` if that wasn't captured either.
- Brand-only pages aren't route-gated by role (see "Auth and roles" above).

## No local migration history (yet)

**`supabase/` does not exist in this repo as of this writing** — every migration built for this project was created and later removed from disk outside of git's tracking (not gitignored, never committed). The live Supabase project (ref `nfeuykwnqqtdecwucujo`, from `NEXT_PUBLIC_SUPABASE_URL`) is the **only** source of truth for the schema until someone runs the local setup below. Don't assume migration files exist, don't try to diff against them, and check the live project directly (Supabase MCP tools — `list_tables`, `execute_sql` — or the dashboard) before making schema changes, unless you've just confirmed `supabase/migrations/` exists on disk.

To set up local dev and reconstruct migration history (needs a container runtime — OrbStack or Docker Desktop):

```bash
brew install --cask orbstack
supabase login
supabase init
supabase link --project-ref nfeuykwnqqtdecwucujo
supabase db pull      # writes supabase/migrations/ from the live schema
supabase start        # local Postgres/Auth/Storage/Studio, separate from prod data
```

Once `supabase/` exists: **commit** `supabase/migrations/` and `supabase/config.toml`; `.gitignore` already excludes the CLI's local-only state (`supabase/.branches`, `supabase/.temp`, `supabase/.env`). New schema changes should then go through `supabase migration new <name>` + `supabase db push`/`db pull` rather than only against the live project directly — update this section once that's actually the workflow in use, since right now it isn't.

Local Supabase also needs its own Google OAuth redirect URI (`http://127.0.0.1:54321/auth/v1/callback`) registered in the Google Cloud console alongside the prod one — the YouTube connector's OAuth client is separate from Supabase's, see "Auth and roles" above.
