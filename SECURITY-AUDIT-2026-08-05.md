# Security audit — videocut (Clipper marketplace)

Date: 2026-08-05. Scope: full repo — 23 API routes, 34 migrations / all RLS policies, client components, proxy guard, storage, dependencies. Read-only; nothing was modified.

**Terminology note:** these are not "zero-days" in the CVE sense (no public advisory exists for your code). They are previously-undiscovered vulnerabilities in first-party code. One genuine set of published CVEs *does* exist in your dependencies — see D-1 at the end.

Everything below was confirmed by reading the actual file, not inferred. Where something is latent rather than live, that is stated.

---

## STATUS as of 2026-08-06 — remediation complete except three items

| Finding | Status |
|---|---|
| CRIT-1 payee controls payout inputs | **Fixed.** Column guards + CHECK constraints on all four tables; the writes that legitimately touch those columns moved to the service-role client. |
| CRIT-2 no idempotency on approve | **Fixed.** Entry guard plus an atomic compare-and-swap claim; reverts on transfer failure so a retry stays possible. |
| HIGH-4 empty webhook secret verifies | **Fixed.** Own HMAC, fails closed on missing *or* empty secret, `timingSafeEqual`. |
| HIGH-5 invite repointing | **Fixed.** `campaign_id`/`clipper_id`/`invited_by` frozen on update. |
| HIGH-6 reviews plantable | **Fixed.** `can_review()` repeated in the UPDATE `WITH CHECK`. |
| HIGH-7 unconfirmed super-admin email | **Fixed in code** (`email_confirmed_at` required). **Still needs a dashboard check** — confirm email signup is off on the hosted project. |
| M-1 `brand_profiles` using(true) | **Fixed.** Blanket policy dropped; display identity moved to a `brand_public` view. |
| M-2 message injection | **Fixed.** `can_access_conversation()` added to the UPDATE `WITH CHECK`. |
| MED-3 status write on wrong client | **Fixed** as part of CRIT-2. |
| M-4 bid rewriting | **Fixed.** `bid_amount`/`clipper_id`/`campaign_id` frozen after insert. |
| M-5 self-declared brand reads all creators | **Fixed.** Replaced with a relationship test (`has_engagement_with_creator`). |
| M-6 anon-callable oracles | **Fixed.** EXECUTE revoked from public/anon/authenticated on both. |
| M-7 no security headers | **Fixed.** XFO/nosniff/Referrer-Policy/HSTS/Permissions-Policy enforced; **CSP is Report-Only** pending a quiet reporting period. |
| M-8 public avatars bucket | **Fixed.** MIME allowlist + 5 MB limit on the bucket; extension derived from sniffed type, not the filename. |
| **M-9 OAuth tokens in plaintext** | **NOT FIXED — deliberately deferred.** See below. |
| **M-1 `profiles` using(true)** | **NOT FIXED — accepted.** Reasoning recorded in `20260806023540`. |
| **D-1 dependency CVEs** | **NOT FIXED — deferred.** Needs `next@16.3.0`, outside the stated range. |

**One product-visible change, flagged rather than buried.** `/clippers` (the brand-facing creator directory) selected `clipper_profiles` with no `is_public` filter, so it leaned entirely on the dropped "Brands can view all clipper profiles" policy — it was listing creators who had explicitly set their profile unlisted. After M-5 it shows public profiles plus creators who have applied to or been invited to that workspace's campaigns. Production currently has **one** unlisted profile, which will drop out of that list unless there's an engagement. This reads as the intended fix rather than a regression, but it is a behaviour change and someone should confirm they agree. `saved/page.js` has the same shape for an unlisted creator saved before the change.

**Why M-9 is deferred rather than done badly.** Encrypting `youtube_connections.access_token`/`refresh_token` is not a migration — it is a key-management decision (Supabase Vault vs `pgsodium` vs app-level AES with a KMS key), plus a re-encryption path for existing rows and a change to every read site. Done hastily it produces the *appearance* of encryption with the key sitting next to the data, which is worse than the honest plaintext it replaces. It needs its own design pass. Note the same gap applies to `clipper_payout_accounts.pan` and `bank_account_number`, which AGENTS.md already records.

**Verification.** `npm run verify` is green: lint 0 errors, build passes, **101 RLS checks pass**. Every new check was proved to fail by breaking its invariant and restoring it. Migrations are applied **locally only** — production is still on `20260805011434`.

---

**Verified against production, not just migration files.** Because AGENTS.md warns that schema changes have been made outside any single session, I queried `pg_policies` and `pg_proc.proacl` on the live project (`nfeuykwnqqtdecwucujo`). For all nine tables involved in the findings below, **production matches the migration files exactly** — every policy predicate quoted here is the one actually running. The two anon-callable function grants (M-6) were likewise confirmed from live `proacl`, not inferred from default-privilege reasoning.

---

## CRIT-1 — The payee controls every input to their own payout amount

`src/app/api/payments/submissions/[id]/approve/route.js` computes the transfer amount on the **service-role client** (which bypasses RLS) from three columns the clipper can write directly via PostgREST with their own session token. There is no column-scope guard on any of them, and no CHECK constraint on the numeric columns.

**Input (a) — `youtube_videos.view_count`**, route lines 76-85:
```js
const { data: video } = await admin.from("youtube_videos")
  .select("view_count").eq("user_id", submission.clipper_id).eq("video_id", videoId).single();
if (video?.view_count != null) viewCount = video.view_count;
...
amount = (viewCount / 1000) * agreedRate;
```
Policy `20260725075602_remote_schema.sql:671` — `FOR UPDATE TO authenticated USING (auth.uid() = user_id)`, no column restriction. Column is bare `bigint` (`:312`), no CHECK.
Attack: `PATCH /rest/v1/youtube_videos?video_id=eq.<own video>` with `{"view_count": 999999999}`.

**Input (b) — `youtube_connections.payout_multiplier`**, route lines 56-61 and 88:
```js
amount = Math.round(amount * payoutMultiplier * 100) / 100;
```
Policy `remote_schema.sql:663`, same shape. Column is bare `numeric` (`:296`), no CHECK. This is a **direct multiplier on the final INR figure** — set it to 1000.

**Input (c) — `campaign_submissions.view_count_at_submission`**, route line 72. Lowest effort of the three: the clipper writes this at insert time, and if they submit a `video_url` from which `extractYoutubeVideoId` returns nothing, the `if (videoId)` branch at line 75 never runs and their own number is used verbatim. No second request needed.

**Input (d) — the destination.** Route line 49 gates on `payoutAccount.status !== "active"` and `razorpay_account_id`, but policy `remote_schema.sql:597` lets the clipper `PATCH` both. They can self-activate, skip KYC entirely, and point the transfer at any Razorpay account id.

**Bound:** the budget check at line 156 caps a single clipper at the campaign's *entire funded budget*. Not unbounded — but one clipper drains one whole campaign, and it is the only ceiling; nothing bounds `amount` before it reaches `createHeldTransfer` at line 174.

**Live or latent:** currently **latent** — Razorpay Route is not enabled on the account, so `createHeldTransfer` 400s and the handler falls through to the `catch`. This becomes live the day Route is turned on. Fix it before that support ticket lands, not after.

**Root cause.** Every table added *after* the baseline got a column-scope guard trigger (`tg_guard_source_asset_pipeline_columns`, `tg_guard_highlight_candidate_columns`, `tg_guard_profile_role`) because the authors correctly identified that RLS cannot restrict *which columns* an UPDATE touches. That insight was never applied backwards to the four baseline tables that feed the payout arithmetic.

**Fix:** add `BEFORE UPDATE` guard triggers on `youtube_videos`, `youtube_connections`, `clipper_payout_accounts`, and `campaign_applications` that raise when `auth.uid()` is non-null and a pipeline/money column changed — the exact pattern already in `20260801044647_source_assets.sql:84`. Add CHECK constraints (`payout_multiplier between 0 and 1`, `view_count >= 0`). Re-fetch view counts from the YouTube API server-side at approve time rather than trusting a stored row.

---

## CRIT-2 — `approve` has no idempotency guard; repeated calls create repeated transfers

Same file. Nothing checks `submission.status !== "approved"` on entry. The transfer is created at line 174, and only *then* is the payout row upserted (lines 180-191) with `onConflict: "application_id,milestone_id"`. Because the unique index is `nulls not distinct` (`20260726232519`), the second call **updates the same row**, overwriting `razorpay_transfer_id`. The `committed` sum at line 149 therefore never grows, so the budget guard at line 156 never trips.

POST the endpoint N times → N held Razorpay transfers, one DB row. The orphaned holds have no `razorpay_transfer_id` recorded anywhere, so `payouts/[id]/release` (line 42) can never release or reverse them — money stuck on hold with no handle to it.

**Live or latent:** same Route dependency as CRIT-1 — `createHeldTransfer` currently 400s, so this is latent today and live the moment Route is enabled. That claim rests on the probe dated 2026-07-26 recorded in AGENTS.md, ten days stale as of this audit; re-run `npm run razorpay:probe` to confirm it still holds.

**Fix:** early-return if `submission.status === "approved"`. Insert the payout row in `pending` state *before* the Razorpay call and let the unique constraint be the lock.

---

## MED-3 (downgraded from CRIT) — The submission status write runs on the wrong client with the error discarded

Lines 166-169:
```js
await supabase                       // RLS client — every other write here uses `admin`
  .from("campaign_submissions")
  .update({ status: "approved", updated_at: ... })
  .eq("id", id);
```
No `const { error }` destructure at all, and it is the only write in the handler on the RLS client rather than `admin`.

**Corrected on verification — this is a robustness defect, not a live hole.** I initially wrote this up as critical on the theory that RLS could refuse the update while the transfer still fired. It cannot, in the normal path: the live policy `"Workspace members can review submissions"` on `campaign_submissions` is `using (exists (... is_campaign_workspace_member(ca.campaign_id)))`, and the route has already established workspace membership at line 31. So the write succeeds whenever the caller got this far.

What remains real: the error is silently discarded, so *any* future policy tightening, transient failure, or connection error turns into "transfer created, submission still `submitted`" with no signal. Combined with CRIT-2's missing entry guard, the state machine has no anchor in either direction. Worth fixing; not worth ranking above the money bugs.

**Fix:** use `admin`, capture the error, abort before the Razorpay call on failure.

---

## HIGH-4 — An *empty* `RAZORPAY_WEBHOOK_SECRET` makes every webhook signature verify

`src/lib/razorpay.js:5-11` → `node_modules/razorpay/dist/utils/razorpay-utils.js:66-71`:
```js
if (!isDefined(body) || !isDefined(signature) || !isDefined(secret)) { throw ... }
var expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');
return expectedSignature === signature;
```
`isDefined("")` is `true`. An **unset** var throws (fail-closed). A **set-but-empty** var — blank field in the Vercel dashboard, `RAZORPAY_WEBHOOK_SECRET=` in an env file, a failed secret sync — sails through and HMACs with an empty key. Anyone can then compute a valid signature.

With that, `POST /api/payments/webhook` with a forged `payment.captured` flips a campaign to `funding_status: "paid", status: "active"` (route lines 24-33) with **no money received** — which is exactly the precondition `approve/route.js:37` checks before creating transfers.

`/api/payments/campaigns/[id]/verify` is *not* affected: `validatePaymentVerification` uses `if (!secret) throw`, which does catch `""`.

Secondary: `expectedSignature === signature` is a plain string compare, not timing-safe — notable only because your own `cron/ai-jobs` and `webhook/sarvam` routes both correctly use `timingSafeEqual`.

**Fix:** assert `RAZORPAY_WEBHOOK_SECRET` is non-empty at module load and throw if not. Wrap the compare in `crypto.timingSafeEqual`.

---

## HIGH-5 — Invite recipients can repoint an invite at any campaign

`20260726185312_campaign_visibility_and_invites.sql:66-70`:
```sql
create policy "Recipients respond to their invites"
  on public.campaign_invites for update to authenticated
  using (clipper_id = (select auth.uid()))
  with check (clipper_id = (select auth.uid()));
```
`campaign_id` is unconstrained on both sides. A clipper who has received **one** invite can `PATCH` that row's `campaign_id` to any campaign uuid. `is_invited_to_campaign()` then returns true, granting both read (`20260726185742:60`) and apply (`20260726185312:147-167`) on private, invite-only campaigns.

This defeats exactly the threat the migration's own comment names — *"A clipper who learned an invite-only campaign's id could apply to it"* — and the `unique (campaign_id, clipper_id)` constraint does not prevent it.

**Fix:** add `and campaign_id = (select campaign_id from campaign_invites where id = ...)` — or more simply, a guard trigger freezing `campaign_id` and `clipper_id` on update, leaving only `status`/`responded_at` writable.

---

## HIGH-6 — Reviews: the UPDATE policy drops the eligibility check, so you can plant a review on anyone

`20260726221933_reviews.sql:131-142`. The INSERT policy calls `can_review(application_id, direction, subject_id)`. The UPDATE's `WITH CHECK` does not:
```sql
using  (author_id = auth.uid() and not is_published and created_at > now() - interval '1 hour')
with check (author_id = auth.uid() and not is_published)
```
Within the one-hour window the author can rewrite `subject_id`, `application_id`, `direction`, `rating` and `body` freely. **Confirmed against the live database** — production `with_check` on this policy is exactly `((author_id = auth.uid()) AND (NOT is_published))`, with no `can_review(...)` term, while the INSERT policy's is `((author_id = auth.uid()) AND can_review(application_id, direction, subject_id))`. Leave the counterpart review unwritten so the pairing trigger never fires, and the SELECT policy (`:107-114`) publishes it to **anon** anyway after 14 days — and `creator_stats.avg_rating` counts it. There is no DELETE policy on `reviews`, by design.

One completed payout buys the ability to plant a permanent public 1-star review on an arbitrary user.

Secondary on the same policy: every review body and rating in both directions becomes readable by unauthenticated visitors after 14 days, including one-sided reviews that were never meant to publish.

**Fix:** repeat `can_review(...)` in the UPDATE `WITH CHECK`, or freeze the identity columns with a trigger.

---

## HIGH-7 — `isSuperAdmin` accepts an unconfirmed email, and email signup is enabled

`src/lib/admin.js`:
```js
return Boolean(user?.email) && user.email === process.env.SUPER_ADMIN_EMAIL;
```
No `email_confirmed_at` check. Meanwhile `supabase/config.toml:226` has `enable_confirmations = false` and `:67` has email signup enabled. The UI is Google-only, but Supabase's `/auth/v1/signup` is reachable directly with the publishable key that ships in the client bundle.

An attacker POSTs to `/auth/v1/signup` with `SUPER_ADMIN_EMAIL` and any password. Confirmations off → session immediately usable → `isSuperAdmin` passes → `admin/page.js:21` hands them a service-role client that bypasses RLS on every table, `admin.auth.admin.listUsers()` dumping every user email, and role rewrites for any user.

**Caveat, stated honestly — this is the one finding I could not fully confirm.** `config.toml` is the *local stack* config; it is evidence about the hosted project's setting, not proof, and the auth provider config is not queryable from the database. What I could check on production: `auth.users` holds 3 users, **0 unconfirmed, 0 with the `email` provider, 0 with a password set** — so no email/password account exists today and the hole has not been used. Whether it is *reachable* depends entirely on whether email signup is enabled on the hosted project, which needs a look at Authentication → Providers in the dashboard.

The missing `email_confirmed_at` check in `admin.js` is unconditional either way, and is worth adding regardless of that setting.

**Verified clean on the same function:** an undefined or empty `SUPER_ADMIN_EMAIL` fails *closed* — the `Boolean(user?.email) &&` short-circuit means `undefined === undefined` is never reached. Case-sensitivity also fails closed, since Supabase lowercases emails at signup.

**Fix:** require `user.email_confirmed_at`, disable email signup on the hosted project, and move the super-admin flag to a database column or JWT claim rather than an env-var email compare.

---

## MEDIUM findings

**M-1 — `brand_profiles` and `profiles` `using (true)` were never dropped.** `remote_schema.sql:491` and `:495`. `20260726211302_workspaces.sql:337-343` added a properly workspace-scoped policy but only dropped *its own* name. Policies OR together, so the restrictive one is dead weight — confirmed by grep, no drop for `"Anyone can view brand profiles"` exists anywhere. Every authenticated user (any clipper, any competitor) reads every brand's `guidelines`, `tone_notes`, colors, fonts, `company_name`, `website`, `industry`, `workspace_id`. The contradiction is explicit in your own tree: `20260801043611:133-138` locks `brand_voice` to the workspace because *"tone, audience, sample captions… is positioning a brand may not want shared"*, while `tone_notes` and `guidelines` sit world-readable.

**M-2 — `messages` UPDATE omits the conversation check.** `20260726223336_chat.sql:115-118` constrains `sender_id` but not `conversation_id`. A user can move one of their own messages into any conversation uuid, injecting content into a private brand↔creator thread. `messages` is in the `supabase_realtime` publication (`:208`), so the injected row is pushed live to every subscriber. The attacker cannot read the thread back — a one-way phishing/impersonation primitive.

**M-3 — `approve` accepts any workspace role, including `billing`.** Route line 33 tests `!role` for truthiness only, unlike every sibling route (`fund` uses `MONEY_ROLES`, the AI routes use `CAMPAIGN_ROLES`). A `billing` member — deliberately excluded from running campaigns — can create held transfers.

**M-4 — `campaign_applications` UPDATE has no column scope.** `20260726211302:250-253`. Intended for `status`/`reviewed_at`; permits any workspace member (including a `member`-role junior designed to be unable to move money) to rewrite `bid_amount`, which `approve/route.js:67` reads as `agreedRate`, and `clipper_id`, redirecting the payee.

**M-5 — `clipper_profiles` read gate keys on a self-declared role.** `remote_schema.sql:539` grants read on every clipper profile to anyone whose `profiles.role = 'brand'` — including `is_public = false` ones (bio, `rate_amount`, `pricing_model`, location, handle). `20260805011434` locks the role after first choice, but the choice at signup is free.

**M-6 — Two SECURITY DEFINER helpers are anon-callable. Confirmed live from `pg_proc.proacl`.** `remote_schema.sql:1006` grants EXECUTE on all functions to `anon` by default; the per-function revokes only removed `public`. Production ACLs show `anon=X/postgres` on all eleven policy helpers. Nine of them reference `auth.uid()` and so return false/null for an anonymous caller — I read the live `prosrc` of `can_review` specifically to confirm it is self-scoped in *both* branches, so it is not an oracle. **Two genuinely leak:**

- `workspace_owner(ws uuid)` — live body is `select owner_id from public.workspaces where id = ws`, with no `auth.uid()` anywhere. Any unauthenticated caller hitting `/rest/v1/rpc/workspace_owner` gets the owner's user id for any workspace uuid. Chains with M-1, which hands every authenticated user the full `workspace_id` list.
- `has_required_approvals(ws, p_subject_type, p_subject_id, p_amount)` — live body reads `approvals` and `approval_policies` with no caller check. An unauthenticated approval-state and threshold-policy oracle.

Also confirmed live: `check_handle_not_reserved()` carries `=X/postgres` (the PUBLIC grant) *plus* `anon` and `authenticated` — it escaped the revoke sweep entirely, as predicted in L-6. Conversely, the sweep did work where it ran: `emit_notification`, `emit_workspace_notification`, `handle_new_user`, `rls_auto_enable` and all 20 `tg_*` functions show only `postgres` and `service_role`.

*(Good news: `search_path` is pinned on 100% of your SECURITY DEFINER functions — no escalation vector there.)*

**M-7 — No security headers anywhere.** `next.config.mjs` is 7 lines with no `headers()`; `vercel.json` has only `crons`; the proxy returns the response untouched. No CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or HSTS. The admin panel and the payment-funding UI are both framable.

**M-8 — Public `avatars` bucket with no MIME allowlist, no size limit, unsanitized extension.** `src/lib/storage.js:38` is the only one of three upload helpers with no character filter (its siblings at `:61` and `:109` both use `replace(/[^a-zA-Z0-9._-]/g, "-")`). The bucket is `public: true` (`20260731191104:23`) with no `allowed_mime_types` or `file_size_limit`, unlike `source-assets`. A user can store `evil.svg` served publicly and permanently from the Supabase storage origin — SVG-borne script on the origin where storage tokens live. RLS pins the path prefix to `auth.uid()`, so it is self-scoped only; no cross-user overwrite, no traversal.

**M-9 — Google OAuth refresh tokens stored in plaintext.** `connectors/youtube/callback/route.js:37-38`. Long-lived, YouTube read + analytics scope. Any RLS gap or the HIGH-7 super-admin compromise (which reaches a service-role client) yields durable access to every connected creator's channel. Same class as the known PAN / bank-account plaintext gap already noted in AGENTS.md.

---

## LOW findings

> **Status: all fixed on 2026-08-05**, except L-4 which was withdrawn as a false positive. The three migrations (`20260805173441`, `20260805173443`, `20260805173445`) are written but **not yet applied** — see the bottom of this section. Fixing L-1 also turned up a money bug next door: `verify-bio` was nulling `payout_multiplier` on success, so bio-code-verified creators were paid at 1.0x instead of 0.75x. Fixed in the same pass.

- **L-1 — `choose-method` self-certifies a channel.** `connectors/youtube/choose-method/route.js:44-51` stamps `verified_at` and `payout_multiplier: 1.0` for `method: "linked"` with zero calls to YouTube, and the connection row is client-insertable with an arbitrary `channel_id`. Only display surfaces read it today (`verified-badge.jsx`, `connectors/page.js`), so it is trust-badge impersonation, not direct money loss — the money column on that table is CRIT-1(b). Note the badge is republished to anon via the `creator_verification` view.
- **L-2 — `extractYoutubeVideoId` uses substring hostname matching.** `src/lib/youtube.js:14` — `hostname.includes("youtu.be")` matches `youtu.be.attacker.com`, and the `?v=` branch checks no hostname at all. No SSRF today because nothing fetches the parsed URL; it becomes a vulnerability the moment a server-side fetch is added.
- **L-3 — Postgres error text returned verbatim** at `admin/users/[id]/role:40`, `workspace/invite:78,111`, `workspace/members/[userId]:60,106`. Leaks constraint, column and policy names. The payments routes correctly return fixed strings — this is the inconsistent set.
- **L-4 — ~~PII in logs~~ — FALSE POSITIVE, withdrawn.** I claimed `payments/payout-account/route.js:70` logs a Razorpay error carrying the submitted PAN, bank account number and IFSC. It does not. The SDK normalizes every rejection through `normalizeError` (`node_modules/razorpay/dist/api.js:32-37`), which keeps only `{statusCode, error}` from the API's *response* and discards the axios request config holding the body. Verified at all six `.catch(normalizeError)` sites. No code change; nothing to fix.
- **L-5 — `rls_auto_enable()` exists but no `CREATE EVENT TRIGGER` does.** No such statement anywhere in `supabase/migrations/`; it lives only as dashboard state on the hosted project. Combined with `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon`, a fresh `supabase db reset` has no auto-enable net. Nothing is exposed today (all 34 tables have explicit `enable row level security`), but `tests/rls.sql` validates a schema that differs from production in exactly this respect.
- **L-6 — `check_handle_not_reserved()` escaped the EXECUTE-revoke sweep.** `20260801051640:42-58` matches `proname like 'tg\_%'` or four explicit names; this function matches neither. The sweep's self-verification block uses the *same predicate*, so it reports success while leaving one function behind. Returns `trigger`, which likely keeps it off `/rest/v1/rpc` — flagged as a gap in the sweep's stated invariant, not a confirmed exploit.
- **L-7 — Zero URL-scheme validation on stored user URLs.** `submission-form.jsx:46-50` and `brand-profile-form.jsx:71` write raw URLs; they render as `href` in the brand's session (`campaign-applications-list.jsx:225`) and the super admin's (`admin-brands-table.jsx:82`). React 19.2.4 blocks `javascript:` at render (verified in `react-dom-client.development.js:3168`), so the stored-XSS chains are **not currently exploitable** — the finding is that the app contributes nothing to its own defense. Residual and *not* blocked by React: `<img src={item.thumbnail_url}>` on the public profile page, attacker-choosable via `portfolio-manager.jsx:52-58`, giving an arbitrary outbound GET (visitor IP/UA logging) with no CSP `img-src` to constrain it.
- **L-8 — `/api/*` is absent from `PROTECTED_PATH_PREFIXES`.** All 23 routes are independently gated, so not exploitable — but the proxy provides no backstop, so a future route that forgets `getUser()` is wide open with nothing to catch it. (Page coverage *is* complete, and the two webhook routes must stay excluded.)
- **L-9 — Page gate and API gate disagree.** `/connectors` is clipper-only at the page (`page.js:17-19`) but every `/api/connectors/youtube/*` route checks only `getUser()`. A brand-role user can drive the whole OAuth flow via the API. Same shape for `dashboard`, `analytics`, `clippers`, `clipper-profile`, `brand-profile`, `payout-account`.
- **L-10 — `workspace_members` INSERT can preset `accepted_at`.** `tg_guard_member_self_update` is `before update` only, so an owner/admin can insert a pre-accepted membership — contradicting the stated invariant that *"nobody is silently added to an organisation."*

---

## D-1 — Dependencies: 9 published CVEs, 6 high

`npm audit`: **9 vulnerabilities (3 moderate, 6 high)**. The one that actually matters:

- **`sharp` < 0.35.0** — inherited libvips CVEs **CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591** (GHSA-f88m-g3jw-g9cj), high. Reached transitively through `next`. Image-decode memory-safety bugs; exposure depends on whether any user-supplied image is processed server-side. You have no `next/image` usage (every image site is a raw `<img>` with an eslint-disable), which limits it — but Next.js ships the image optimizer regardless.
- `brace-expansion` — two high DoS advisories, build-time only.
- `postcss`, `@hono/node-server` (Windows-only path traversal) — moderate, build/tooling.

The fix requires `next@16.3.0`, outside your stated range. Treat as a planned upgrade, not `npm audit fix --force` on a Friday.

---

## What is genuinely solid (checked, not assumed)

Worth stating so the list above is read in proportion — this codebase is more security-aware than most:

- **No mass assignment anywhere.** No `...body`, no `Object.assign` of parsed JSON into any insert or update across all 23 routes.
- **`createAdminClient()` ordering is correct in all 7 routes that use it** — ownership is always proven on the RLS-scoped client *first*, with a real predicate, never a truthiness test on a body value.
- **No IDOR.** Every `[id]`/`[userId]` route pairs the param with an ownership predicate.
- **No SSRF.** Every `fetch()` in server code targets a hardcoded constant or a URL from a trusted provider response.
- **No secrets reach the client.** Zero client components read `process.env` at all; `createAdminClient` is never imported from a `"use client"` file.
- **No env file was ever committed** — `git log --all -- '.env*'` is empty.
- **OAuth CSRF is properly handled** — `crypto.randomUUID()` state, httpOnly + sameSite cookie, compared and deleted before anything else.
- **Cron and Sarvam webhook auth both fail closed and use `timingSafeEqual`** with a length pre-check. (The Razorpay webhook is the inconsistent one — HIGH-4.)
- **Funding-path amounts are server-derived** from `campaign.budget`, never from a body value, and the order id is cross-checked before signature verification.
- **`ai_jobs`, `campaign_payouts`, `notifications`, `source_assets`, `highlight_candidates` are all correctly modelled** — no client insert/update policy, service-role only.
- **`search_path` is pinned on 100% of SECURITY DEFINER functions.**
- **No cross-user read of PAN, bank account number, OAuth token, or email exists.** Stated plainly because it is the honest answer.
- **File upload is well-built** — `workspace_id` is verified, `storage_path` is server-derived, filename is sanitized, and the signed URL is deliberately minted on the RLS client so storage policies still adjudicate.

---

## Why a green `npm run verify` misses all of this

`supabase/tests/rls.sql` is 1,399 lines and rigorous about *membership boundaries*. It has **zero cases** for column-level write scope on `youtube_videos`, `youtube_connections`, `clipper_payout_accounts`, or `campaign_applications` — the four tables feeding the payout math. The technique it tests thoroughly at `rls.sql:1216-1231` ("member CANNOT write pipeline columns") is never applied to the money tables. It also never probes the UPDATE policies on `campaign_invites`, `reviews`, `contracts`, or `messages`, and never tests `brand_profiles`/`profiles` read scope.

One case tests the right table on the wrong axis (`rls.sql:339-347`): it asserts `youtube_connections` has no anon *read* policy. True, and it passes — but the exposure on that table is the owner's unrestricted *write* scope over `payout_multiplier`.

**Every finding above survives a fully green suite.** Any fix should ship with a red-first test case in `rls.sql`.

---

## Suggested order

1. **HIGH-4** — one-line assertion that `RAZORPAY_WEBHOOK_SECRET` is non-empty. Do it today; it is the only finding that is live right now, needs no Razorpay feature flag, and forges paid campaigns.
2. **HIGH-7** — check Authentication → Providers in the Supabase dashboard. If email signup is on, turn it off; add the `email_confirmed_at` check to `admin.js` either way.
3. **CRIT-1 and CRIT-2** — before Razorpay Route is enabled. These are the largest findings but are gated on Route, so you have a window. One migration (guard triggers + CHECK constraints on the four money tables) plus one route rewrite (entry status guard, pre-insert the payout row).
4. **HIGH-5, HIGH-6, M-2, M-4** — one migration adding the missing `WITH CHECK` terms and column-freeze triggers. Same shape as the guards in step 3; consider doing them together.
5. **M-1** — one `drop policy "Anyone can view brand profiles"` statement, plus the same for `profiles` if you want the directory scoped.
6. **M-6** — `revoke execute on function workspace_owner(uuid), has_required_approvals(uuid,text,uuid,numeric), check_handle_not_reserved() from public, anon, authenticated`, then re-grant `authenticated` only where a policy needs it (neither of the two leaking helpers is used in a policy).
7. **M-7** — one `headers()` block in `next.config.mjs`.
8. **MED-3** and everything else as normal backlog.

Every fix should ship with a red-first case in `supabase/tests/rls.sql` — break the policy, watch the row turn red, restore. The suite's current green is not evidence for any of these.
