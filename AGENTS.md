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

### ⚠ Policy cycles — read before adding an RLS policy

**A policy on table A must not read table B if any policy on B reads A.** Postgres raises `42P17 infinite recursion` at *query* time, not at policy-creation time, so the policy is created happily and every affected query then fails. This shipped once: `campaigns`' "applied to" policy reads `campaign_applications`, whose brand policy reads `campaigns` — clippers could not list campaigns at all.

Route the inner lookup through a `SECURITY DEFINER` helper instead (`has_applied_to_campaign`, `is_invited_to_campaign` in `20260726185742_fix_campaigns_policy_recursion.sql`). Those bypass RLS on the inner table — safe here because the tables are `postgres`-owned and do not `FORCE` row security — and each answers only a yes/no about the caller.

### Revoking EXECUTE takes all three grantees

A `SECURITY DEFINER` function in `public` is reachable at `/rest/v1/rpc/<name>` unless EXECUTE is revoked from **`public`, `anon` and `authenticated`**. Missing either half achieves nothing, and both halves have already been got wrong here:

- Postgres grants EXECUTE to `PUBLIC` by default and both roles inherit it, so revoking from the two roles alone leaves the function callable.
- Supabase *also* grants EXECUTE to `anon` and `authenticated` directly, so `revoke ... from public` alone does not undo those — which is why several migrations that look like they handled this did not.

Trigger functions never need EXECUTE (the trigger mechanism does not check it), so revoke freely — `20260801051640_revoke_execute_on_trigger_functions.sql` does this for all of them and asserts the result. **Policy helpers are the opposite**: a definer function called inside an RLS policy *is* permission-checked against the caller, so `is_workspace_member` and friends must stay granted to `authenticated` or every policy using them breaks.

**Checking `pg_policies` does not catch this.** Run `npm run test:rls` (`supabase/tests/rls.sql`), which impersonates real brand/clipper users and runs the queries the app runs, inside a transaction that rolls back. See "Verification" below for how to read the result — a green run is not the same as an all-PASS run.

Related: `eslint.config.mjs` enables `no-undef` because `next build` does not render dynamic Server Components and so will not catch a `ReferenceError` in one — that shipped once too.

## The AI pipeline (Phase 3)

`ai_jobs` is the queue — there is no job runner, no worker, and AI work cannot run inside a request. Every AI feature enqueues a row and something completes it later.

- **All writes go through `src/lib/ai/jobs.js` on a service-role client.** `ai_jobs` has no client insert/update/delete policy at all, same rule as `campaign_payouts`: `status`, `model`, `tokens_used` and `credits_charged` are the provider's account of what happened and what it cost. Every transition filters on the open states, so a replayed webhook or a racing poller is a no-op rather than an overwrite.
- **`source_assets` is written by both the user and the pipeline**, and a trigger enforces the split: a signed-in user may rename an asset, but only the pipeline (where `auth.uid()` is null) may write `status`, `transcript`, `duration_seconds`, `storage_path` or `workspace_id`.
- **Transcription is poll-first.** `/api/cron/ai-jobs` is the mechanism; the Sarvam webhook is a latency optimisation that can be dropped. Sarvam's callback carries a job state and **no transcript**, so both paths run the same `reconcileJob`, which fetches the transcript itself. The poller also sweeps jobs whose relay died — nothing else can, because the terminal-status-requires-`completed_at` constraint means a `running` row with a dead owner sits there forever.
- **`/api/ai/webhook/*` must stay out of `PROTECTED_PATH_PREFIXES`.** Sarvam arrives unauthenticated; auth is a constant-time token compare, the same shape as the Razorpay webhook's signature check. Proxying it would redirect every delivery to `/login`.
- **The model proposes, the human decides — and that split is enforced twice.** `source_assets` and `highlight_candidates` both let a member change exactly one thing (the filename; whether a moment is picked) and let the pipeline change everything else, via a trigger keyed on `auth.uid()` being null. Neither has a client insert or delete policy. A client that could write a highlight candidate could hand brief generation a moment that never happens in the recording.
- **AI SDK v7 uses `generateText` + `Output.object()`, not `generateObject`.** Model IDs go through the Vercel AI Gateway as plain `provider/model` strings and should be **fetched from `https://ai-gateway.vercel.sh/v1/models`, never recalled** — they move. A JSON schema constrains the shape of what a model returns and says nothing about whether it makes sense, so `validateCandidates()` in `src/lib/ai/highlights.js` is the layer that decides what gets stored; `npm run highlights:check` is what tests it, with no key and no network.
- **`src/lib/ai/providers/sarvam.js` has never been executed.** It was written from Sarvam's docs and official skills repo with no API key available. `npm run sarvam:probe` is what turns it from written into working — treat its request/response shapes as unverified until that passes. `prepareAudio()` is an intentional no-op seam: if the probe shows video is rejected, ffmpeg extraction goes there and nowhere else.

## Blocked on somebody else's dashboard

`docs/manual-steps.md` lists the things that cannot be fixed with a migration or
a commit — the Razorpay Route/Direct Transfers ticket, the hosted storage upload
limit, the local Google OAuth redirect URI, and two security-advisor findings
that need a decision rather than a reflex. Check it before concluding something
is broken in code.

## Payments (Razorpay)

Uses **Razorpay Route** — the marketplace split-payment product (`account`/linked-account + `transfer` with `on_hold`). Note: Razorpay also has a product literally called "Escrow" (RazorpayX Escrow Plus) — that's for lending/co-lending pooled funds, unrelated, don't confuse the two. **Route is not currently enabled on the account — see the warning below before touching payout code.**

Flow: brand creates a campaign → funds the full budget via Razorpay Checkout (`src/lib/razorpay-checkout.js` client-side, `/api/payments/campaigns/[id]/fund` + `/verify` server-side, signature-verified before the campaign activates) → clipper applies → brand approves the application → clipper submits a video (`campaign_submissions`) → brand approves the submission, which computes the payout (flat fee, or view-count × CPM using `youtube_videos.view_count` if synced, multiplied by the clipper's `youtube_connections.payout_multiplier` verification-tier discount), checks it against the campaign's remaining budget, and creates a held Razorpay transfer → brand releases the hold (`/api/payments/payouts/[id]/release`).

### ⚠ Route is NOT enabled on the Razorpay account — the payout half cannot run

Probed directly with the test keys in `.env.local` on 2026-07-26 (`npm run razorpay:probe` — re-run it after support enables Route). **The keys are real and auth succeeds** — an earlier version of this file claimed every call 401s on placeholder keys, which is wrong. What actually fails is the Route product:

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

Fixing this is a support request to Razorpay to enable Route on test + live, not a code change.

**Route and Direct Transfers are separate on-demand features, and Route can land without Direct Transfers.** When re-running the probe, read the two independently:

- `/v2/accounts` and `GET /v1/transfers` reachable → **Route enabled.** The existing payout code (`createLinkedAccount`, `createHeldTransfer`) can run.
- `POST /v1/transfers` reachable → **Direct Transfers enabled.** The wallet model in `docs/product/08-monetisation.md` is unblocked.

If only the first pair flips, that is a **second support request, not a bug** — ask for Direct Transfers explicitly. Asking for both in the original ticket avoids the round trip.

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

## Local stack and migration history

**`supabase/` exists and is committed** — `config.toml`, 21 migrations, `seed.sql`, and `tests/rls.sql`. An earlier version of this file said it did not; that was true once and is not now. The live project (ref `nfeuykwnqqtdecwucujo`) is no longer the only source of truth, though it is still ahead of nothing and behind nothing — the two match as of the last `db pull`.

Fresh clone, given a container runtime (OrbStack or Docker Desktop):

```bash
supabase login
supabase link --project-ref nfeuykwnqqtdecwucujo
supabase start        # local Postgres/Auth/Storage/Studio, separate from prod data
supabase db reset     # replays every migration, then runs seed.sql
```

`.env.development.local` already points the app at the local stack (`http://127.0.0.1:54321`) and Next.js gives it precedence in dev. **If OrbStack isn't running, `npm run dev` has no database at all** — pages render empty with no error, which looks like a UI bug and isn't.

**Migration filenames must match the version the database recorded.** Most existing migrations were applied through the Supabase MCP `apply_migration` tool, which generates its own timestamp; hand-named files drifted from `supabase_migrations.schema_migrations`, which made every migration look unapplied to the CLI and would have made `db push` re-run non-idempotent files. They were renamed to the recorded versions in `10f9b32`. See `supabase/migrations/README.md` before adding one — including the three recorded versions that deliberately have no file.

## Verification

`npm run verify` = `lint` → `build` → `test:rls`, one exit code. Run it before every commit.

- **`npm run test:rls`** runs `supabase/tests/rls.sql` against `DATABASE_URL` inside a transaction that rolls back. It impersonates real brand/clipper users and runs the queries the app runs. `DATABASE_URL` is not in git (`.gitignore` excludes `.env*`), so on a fresh clone add it yourself — the script exits 2 with instructions until you do:

  ```
  # .env.development.local
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
  ```
- The suite reports by SELECTing rows, so **psql exits 0 even on a wall of FAIL rows** — `scripts/rls-test.sh` reads the verdict out of the output instead. FAIL and SKIP both fail the run; NOTE is allowed. A SKIP means the fixture was missing and nothing was asserted.
- **`supabase/seed.sql`** supplies that fixture (a brand with a workspace, a clipper, a second workspace member). Without it the whole suite returned one SKIP row and looked green.
- New table? Add cases to `rls.sql`, and **prove they can fail** — break the policy, confirm the row turns red, restore. An all-PASS run is evidence of nothing otherwise.

### Rendering a protected page

`next build` does not render dynamic Server Components, which is most of this app, so a protected page can ship having never been rendered once. That has already happened — `/workspace/settings` went out in `0aab9ac` with build, lint and RLS coverage only.

Sign-in is Google-only, so there is no scriptable login. `scripts/dev-session.mjs` works around it against the local stack: it signs in (creating `dev@local.test` as a brand with a workspace on first run, through the real `handle_new_user` path) and prints the session as a Cookie header.

```bash
curl -s -H "Cookie: $(npm run -s dev:session -- --header)" http://localhost:3000/workspace/settings
```

It refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` is localhost — against the hosted project it would create a real password account on a Google-only product.

**This covers server rendering, not interaction.** Client components, form submits and realtime still need a human, or a Chrome MCP session driven through a real Google login. Injecting the cookie into Chrome directly does not work: the permission classifier blocks setting an auth cookie via `document.cookie`.

Local Supabase also needs its own Google OAuth redirect URI (`http://127.0.0.1:54321/auth/v1/callback`) registered in the Google Cloud console alongside the prod one — the YouTube connector's OAuth client is separate from Supabase's, see "Auth and roles" above.
