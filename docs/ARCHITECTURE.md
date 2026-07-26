# Clipper — Architecture

This doc was produced by reading the live codebase (routes, components, `src/lib/`, and `supabase/migrations/`) directly, not by restating `AGENTS.md`. Where the two disagree, see [Known issues / gaps](#known-issues--gaps) at the end.

## 1. Overview

Clipper is a marketplace connecting **brands** (post campaigns, fund a budget) and **clippers** (connect a YouTube channel, apply to campaigns, submit a clip, get paid). Core flow:

```
brand creates campaign → funds full budget via Razorpay Checkout → campaign goes active
  → clipper applies → brand approves application
  → clipper submits a video → brand approves the submission
  → payout computed (flat fee or view-count × CPM × verification multiplier) → held Razorpay transfer created
  → brand releases the hold → clipper gets paid
```

**Stack**: Next.js 16 App Router (`src/proxy.js`, not `middleware.ts` — the framework renamed the convention), React 19 with the React Compiler enabled (`next.config.mjs`: `reactCompiler: true`), Supabase (Postgres + Auth + Storage) via `@supabase/ssr`, Razorpay **Route** for marketplace split payments, Tailwind v4 (CSS-first config, no `tailwind.config.js`), shadcn on `@base-ui/react` (`components.json` → `"style": "base-nova"`, not Radix). Plain JS/JSX throughout — `components.json` has `"tsx": false`, no TypeScript.

## 2. Route map

### `(app)` — public, plain `Header`
| Route | File | Notes |
|---|---|---|
| `/` | `src/app/(app)/page.js` | Static marketing page |

### `(protected)` — authenticated app shell (`app-sidebar.jsx` + `site-header.jsx`)
| Route | File | Gating |
|---|---|---|
| `/dashboard` | `dashboard/page.jsx` | `requireRole(..., "clipper", "/campaigns")` unless `isSuperAdmin`. **No explicit `!user` redirect** (only page missing it — see gaps) |
| `/analytics` | `analytics/page.js` | Same clipper-only gate |
| `/clipper-profile` | `clipper-profile/page.js` | Same clipper-only gate |
| `/connectors` | `connectors/page.js` | Same clipper-only gate |
| `/payout-account` | `payout-account/page.js` | Same clipper-only gate |
| `/campaigns` | `campaigns/page.js` | No redirect-based gate — renders brand view (own campaigns + `CampaignForm`) or clipper view (browse/apply) by `profile.role` |
| `/campaigns/[id]` | `campaigns/[id]/page.js` | Ownership check: `redirect("/campaigns")` unless `campaign.brand_id === user.id` |
| `/brand-profile` | `brand-profile/page.js` | **No role gate** — only `!user` redirect (nav-hiding only) |
| `/clippers` | `clippers/page.js` | **No role gate** — same gap |
| `/profile` | `profile/page.js` | Role-neutral, any authenticated user |
| `/admin` | `admin/page.js` | `isSuperAdmin(user)` gate, `redirect("/dashboard")` otherwise |

All ten route dirs above are covered 1:1 by `PROTECTED_PATH_PREFIXES` in `src/lib/supabase/proxy.js` (`/campaigns/[id]` covered by the `/campaigns` prefix).

### `(legal)` — static pages, shared simple layout
`/privacy`, `/terms`, `/clipper-terms`, `/faq`, `/support` — the latter two intentionally reuse the `(legal)` folder despite the name.

### Ungrouped
`src/app/login/page.jsx` (Client Component, `LoginForm` in a `Suspense` boundary), `src/app/auth/callback/route.js` (Supabase OAuth code exchange → role-based redirect: `/campaigns` for brand, `/dashboard` otherwise).

### `api/` route handlers
| Route | Purpose |
|---|---|
| `connectors/youtube/{start,callback,disconnect,sync,choose-method,verify-bio}` | YouTube OAuth + sync + verification tier selection |
| `payments/campaigns/[id]/{fund,verify}` | Razorpay order creation + signature verification for campaign funding |
| `payments/payout-account`, `.../check-status` | Clipper Razorpay linked-account (Route) onboarding + polling |
| `payments/submissions/[id]/approve` | Computes payout, creates held transfer |
| `payments/payouts/[id]/release` | Releases a held transfer |
| `payments/webhook` | Razorpay webhook — **auth is the HMAC signature, not a session/`isSuperAdmin` check** (explicitly commented in-file) |

No `not-found.js`/`error.js`/`loading.js` exist anywhere under `src/app`.

## 3. Auth & authorization model

Two independent axes:

- **`profiles.role`** (`'clipper' | 'brand'`) — a business-role flag, defaults to `'clipper'` on signup (`handle_new_user()` trigger, see §4), switchable anytime from `/profile`. Drives `app-sidebar.jsx`'s nav (`clipperNavMain` vs `brandNavMain`) and `campaigns/page.js`'s branching — **not itself an enforcement mechanism**.
- **`isSuperAdmin(user)`** (`src/lib/admin.js`) — `Boolean(user?.email) && user.email === process.env.SUPER_ADMIN_EMAIL`. Pure predicate, fails closed if the env var is unset. Used both as a **bypass** for `requireRole` (super admin can view clipper-only pages) and as the **hard gate** on `/admin`.

**Route-level enforcement**: `requireRole(supabase, user, role, redirectTo)` (`src/lib/roles.js`) re-fetches `profiles.role` (defaulting null to `'clipper'`) and calls Next's `redirect()` if it doesn't match. Every current call site passes `role="clipper"` — there is no `role="brand"` call anywhere, so **brand-only pages (`/brand-profile`, `/clippers`) have no route-level guard**, only nav-hiding.

**Session refresh**: `src/proxy.js` → `src/lib/supabase/proxy.js`'s `updateSession()`. Builds a `createServerClient`, calls `supabase.auth.getClaims()` (validates + refreshes the JWT — the file has an explicit "don't run code between client creation and this call" comment), then redirects unauthenticated requests away from any path matching `PROTECTED_PATH_PREFIXES` to `/login?next=<path>`.

**Login**: Google OAuth only (`login-form.jsx`) — no email/password path exists in this codebase.

## 4. Data model

Source: `supabase/migrations/20260725075602_remote_schema.sql` (initial dump) + `20260725092950_add_font_color_to_brand_profiles.sql`.

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (PK), `role`, `full_name`, `avatar_url` | Row auto-created by `handle_new_user()` trigger on `auth.users` insert |
| `brand_profiles` | `user_id` (PK), `company_name`, `website`, `logo_url`, `industry`, `description`, `font_name`, `color_code` | Last two columns added by the second migration, not yet reflected in AGENTS.md |
| `clipper_profiles` | `user_id` (PK), `bio`, `categories[]`, `style_tags[]`, `pricing_model` (`per_clip`/`cpm`/`flat_campaign`), `rate_amount`, `availability_status` | |
| `campaigns` | `id`, `brand_id`, `title`, `payout_structure` (`per_view`/`flat_fee`), `payout_rate`, `budget`, `status` (`draft`/`active`/`completed`/`cancelled`), `funding_status` (`unfunded`/`created`/`paid`/`failed`), `razorpay_order_id`, `razorpay_payment_id` | **DB-level check constraint**: `status` can't be `'active'` unless `funding_status='paid'` — enforced in Postgres, not just app code |
| `campaign_applications` | `id`, `campaign_id`, `clipper_id`, `status` (`pending`/`approved`/`rejected`) | Unique `(campaign_id, clipper_id)` |
| `campaign_submissions` | `id`, `application_id`, `clipper_id`, `video_url`, `view_count_at_submission`, `status` (`submitted`/`approved`/`rejected`) | Submission-time view-count snapshot used as payout fallback |
| `campaign_payouts` | `id`, `application_id` (unique), `clipper_id`, `amount`, `razorpay_transfer_id`, `status` (`pending`/`held`/`released`/`failed`) | No client INSERT/UPDATE policy at all — every write goes through the admin client after a real Razorpay call |
| `clipper_payout_accounts` | `user_id` (PK), `razorpay_account_id`, `legal_business_name`, `pan`, `bank_account_number`, `bank_ifsc`, `status` (`pending`/`active`/`failed`/`under_review`) | PAN + bank account are plain `text` columns — no column-level encryption despite `pgcrypto` being installed |
| `youtube_connections` | `user_id` (unique), `access_token`, `refresh_token`, `channel_id`, `verification_method` (`linked`/`bio_code`), `verification_code`, `payout_multiplier`, `bio_code_confirmed_at` | OAuth tokens also stored plaintext |
| `youtube_videos` | `user_id`, `video_id`, `view_count`, `like_count`, `comment_count` | Unique `(user_id, video_id)` |
| `youtube_channel_stats_daily` | `user_id`, `date`, `views`, `estimated_minutes_watched`, `subscribers_gained` | Unique `(user_id, date)` |
| `youtube_activities` | `user_id`, `activity_id`, `type`, `video_id` | Unique `(user_id, activity_id)` |

RLS is enabled on every table via an event trigger (`rls_auto_enable()`) that force-enables it on any new `public` table. Three recurring policy patterns:

1. **Owner-only**: `to authenticated using ((select auth.uid()) = user_id)` — `clipper_profiles`, `clipper_payout_accounts`, `youtube_*`.
2. **Cross-user `exists()` subquery** — e.g. a brand reading applications on campaigns they own: `exists (select 1 from campaigns c where c.id = campaign_id and c.brand_id = (select auth.uid()))`.
3. **Service-role bypass** (`createAdminClient()`) — used only after the caller's ownership of the row is verified via the normal RLS-scoped client first.

## 5. Payments (Razorpay Route)

`src/lib/razorpay.js` (server) exposes:
- `createOrder(amount, receipt)` — rupees → paise, `client.orders.create`.
- `verifyPaymentSignature(orderId, paymentId, signature)` / `verifyWebhookSignature(rawBody, signature)` — signature checks for checkout completion and webhook delivery respectively.
- `createLinkedAccount(details)` — full onboarding chain: `accounts.create` (type `"route"`) → `stakeholders.create` (PAN) → `products.requestProductConfiguration` → `products.edit` (bank settlement details).
- `checkAccountActivation(accountId, productId)` — polls Razorpay for KYC status.
- `createHeldTransfer(paymentId, accountId, amount)` — `payments.transfer` with `on_hold: true`. Held indefinitely — no `on_hold_until`.
- `releaseTransferHold(transferId)` — `transfers.edit({on_hold: false})`.

`src/lib/razorpay-checkout.js` (client) dynamically loads Razorpay's checkout script and drives the funding flow end-to-end.

Flow across API routes:
1. **`fund`** — brand-ownership check, requires `budget > 0`, `createOrder`, sets `razorpay_order_id`/`funding_status:"created"`.
2. **`verify`** — re-checks brand ownership **and** that the returned `razorpay_order_id` matches the stored one, then `verifyPaymentSignature` → `funding_status:"paid"`, `status:"active"`.
3. **`payout-account`** — clipper submits KYC/bank details → `createLinkedAccount` → upserts `clipper_payout_accounts` (`status:"pending"`, stored even on failure).
4. **`check-status`** — polls `checkAccountActivation`, maps Razorpay's `activation_status` into the local `status` column.
5. **`submissions/[id]/approve`** — computes payout as flat fee, or `(viewCount/1000) × payout_rate` for `per_view` (using synced `youtube_videos.view_count`, falling back to `view_count_at_submission`), multiplied by the clipper's `payout_multiplier`; checks against remaining campaign budget (sum of non-`failed` payouts); creates the held transfer; upserts `campaign_payouts`.
6. **`payouts/[id]/release`** — brand-ownership check, requires `status==="held"`, calls `releaseTransferHold`.

**Webhook** (`payments/webhook/route.js`): reads the raw body (required for HMAC correctness), verifies `x-razorpay-signature` before parsing JSON. Handles `payment.captured` (idempotent via `.neq("funding_status","paid")`), `account.activated`/`account.under_review`/`account.needs_clarification`. Always returns `{ok:true}` even if no matching row is found.

## 6. YouTube connector

OAuth scopes are **read-only**: `youtube.readonly`, `yt-analytics.readonly` — no upload/write access. `start` generates a CSRF `state` in an httpOnly cookie; `callback` validates it, exchanges the code, and upserts `youtube_connections`; `sync` refreshes the token if expired, paginates uploaded videos and pulls 30-day channel analytics into `youtube_videos`/`youtube_channel_stats_daily`/`youtube_activities`; `disconnect` hard-deletes the connection row.

**Verification tiers** (`choose-method/route.js`), exactly two, no others exist in code:
- **`linked`** — OAuth ownership already proves control → `payout_multiplier: 1.0`, instantly verified.
- **`bio_code`** — clipper pastes an issued `CLIP-XXXXXX` code into their channel bio → `payout_multiplier: 0.75` (25% payout discount). `verify-bio` checks the description contains the code, then **clears** the verification fields and sets `bio_code_confirmed_at` — a one-time path; `choose-method` blocks re-selecting `bio_code` once already confirmed.

## 7. UI/component conventions

- **base-ui, not Radix**: composition uses a `render` prop instead of `asChild`. `Button` needs `nativeButton={false}` when its render target isn't a real `<button>`:
  ```jsx
  // src/components/header.jsx
  <Button nativeButton={false} render={<Link href="/login" />}>Sign in</Button>
  ```
  Same pattern in `youtube-connector-card.jsx` (`render={<a href="/api/connectors/youtube/start" />}`), `campaign-card.jsx`, and non-`Button` primitives like `SidebarMenuButton`/`DropdownMenuTrigger` (`nav-main.jsx`, `nav-user.jsx`).
- **Forms**: no `react-hook-form`, no `zod` — plain `useState` per field, manual `async handleSubmit` hitting Supabase directly or a `fetch()` to an API route, HTML5 `required`/`type` attributes for validation, errors surfaced via `<Alert variant="destructive">`. Sectioned with `Field`/`FieldSet`/`FieldLegend`/`FieldSeparator` (`ui/field.jsx`). Standalone-page forms (`clipper-profile-form.jsx`, `brand-profile-form.jsx`, `payout-account-form.jsx`) are centered via `mx-auto w-full max-w-3xl` passed down from their hosting page; dialog forms (`campaign-form.jsx`, `submission-form.jsx`) don't follow this since they're not full pages.
- **Container queries**: Tailwind v4's `@container` is used for content that should respond to its own box, not the viewport — `@container/main` wraps dashboard/analytics page bodies, `@container/card` on stat cards with an arbitrary breakpoint (`@[250px]/card:text-3xl`), `@container/field-group` inside `ui/field.jsx`.
- **Admin tables**: `admin/page.js` does all data fetching server-side via `createAdminClient()` (9 parallel queries), passing fully-joined arrays down as props. The table components (`admin-clippers-table.jsx`, `admin-brands-table.jsx`, `admin-campaigns-table.jsx`) are Client Components only to hold "which row is open" state for a click-to-open `Sheet` detail view; `admin-payouts-table.jsx` is a plain Server Component with no detail sheet.

## Known issues / gaps

- **AGENTS.md is stale on `supabase/`**: it states migrations were never committed to this repo. That's no longer true — `supabase/migrations/20260725075602_remote_schema.sql` and `supabase/migrations/20260725092950_add_font_color_to_brand_profiles.sql` are both git-tracked, and `.gitignore` now has an explanatory comment excluding only local CLI state.
- **`brand_profiles.font_name`/`color_code`** exist in the schema but aren't mentioned in AGENTS.md's schema reference section.
- **Broken RLS policy**: `campaigns` has a policy "Clippers can view campaigns they applied to" that self-references (`a.campaign_id = a.id` instead of comparing to `campaigns.id`) and therefore never matches anything. The policy that actually works for clippers is the separate "funded active campaigns" one (`status='active' AND funding_status='paid'`).
- **`dashboard/page.jsx`** is the only protected page without its own explicit `if (!user) redirect(...)` guard — currently harmless because `(protected)/layout.js` already redirects unauthenticated users first, but an inconsistency worth fixing if that layout/page boundary ever changes.
- **Brand-only pages have no route-level guard**: `/brand-profile` and `/clippers` rely solely on nav-hiding in `app-sidebar.jsx` — a clipper who navigates directly to either URL can still load them.
- **Payouts cannot actually run**: Razorpay Route is not enabled on the account. `/v1/payments` and `/v1/refunds` return 200, but every Route endpoint (`/v2/accounts`, `/v1/transfers`, `/v1/payments/{id}/transfers`) returns "URL not found". So `createLinkedAccount()` and `createHeldTransfer()` in §5 describe code that has never been able to succeed. Campaign funding works; payouts do not. See `AGENTS.md` for the probe results.
  - Consequently the `clipper-terms` copy stating "No real payouts are processed today" is **currently accurate** — an earlier version of this doc called it stale, which was wrong. Only its closing clause ("once a payment processor is integrated") is imprecise: the integration exists in code, the product just isn't provisioned. Revisit the wording when Route is enabled.
- **No PII encryption**: PAN, bank account/IFSC, and YouTube OAuth tokens are all stored in plain-text columns, with no column-level encryption despite `pgcrypto` being installed in the project.
