# Manual steps

Things that cannot be fixed with a migration or a commit, because they live in
somebody else's dashboard. Each one is blocking something real, and each has
been discovered rather than assumed — the evidence is linked.

Delete an entry once it is done.

---

## 1. Ask Razorpay to enable Route **and** Direct Transfers

**Blocks:** every payout. Also the wallet, subscriptions, and
`docs/product/sql/04-monetisation.sql`.

`npm run razorpay:probe` confirms the keys are real and core payments work, but
`/v2/accounts` 404s and `/v1/transfers` 400s. `createLinkedAccount()` and
`createHeldTransfer()` in `src/lib/razorpay.js` therefore target endpoints that
have never been reachable — **the payout half of the product has never been able
to run**, on test or live. Campaign funding is unaffected, because orders and
payments are core API.

Route and Direct Transfers are separately on-demand. Ask for both in one ticket,
or you will do this twice.

> Subject: Enable Route and Direct Transfers on our marketplace account
>
> We run a two-sided marketplace: brands fund a campaign budget up front, and we
> pay creators out of it once work is approved. We need Razorpay Route enabled
> on both our test and live accounts.
>
> On our test account today, `GET /v2/accounts` returns 404 "no Route matched
> with those values" and `GET/POST /v1/transfers` returns 400 "The requested URL
> was not found on the server", while `/v1/payments`, `/v1/settlements` and
> `/v1/refunds` all work normally. That reads to us as Route not being
> provisioned rather than an integration error, but please correct us if the
> calls are wrong.
>
> Please also enable **Direct Transfers** in the same request, as we understand
> it is activated separately from Route.
>
> Two questions we need answered before we finish the payout design:
>
> 1. For direct transfers, can `on_hold` be set at creation time, or must a
>    transfer be created first and then held? We want to avoid a window where
>    funds are transferable before the hold is applied.
> 2. Can linked accounts be placed on a manual or extended settlement schedule,
>    so the hold window is not the only thing preventing early settlement?

Re-run `npm run razorpay:probe` afterwards. Read the two products
independently — `/v2/accounts` reachable means Route is on; `POST /v1/transfers`
reachable means Direct Transfers is on. Only the first flipping is a second
ticket, not a bug.

---

## 2. Raise the hosted project's storage upload limit

**Blocks:** uploading a real recording in production. Local is already done.

`/studio` accepts files up to 5 GB and the `source-assets` bucket carries a
5 GiB limit (applied to production — verified). But **a per-bucket limit cannot
exceed the project's global limit**, which is still at its default. A large
upload will be rejected in production while working locally, which is the most
annoying shape a bug can take.

Supabase dashboard → Project Settings → Storage → raise the global upload limit
to at least 5 GB. `supabase/config.toml` already sets `file_size_limit = "5GiB"`
for the local stack.

---

## 3. Register the local Google OAuth redirect URI

**Blocks:** signing into the local stack through the real login screen.

Google Cloud console → the Supabase Auth OAuth client → add
`http://127.0.0.1:54321/auth/v1/callback` alongside the production one.

Not urgent: `npm run dev:session` sidesteps it for server-rendering checks. It
is needed for testing client components, form submits and realtime, which that
script cannot cover.

Note the YouTube connector uses a *separate* OAuth client from Supabase Auth —
see "Auth and roles" in `AGENTS.md`.

---

## 4. Enable leaked-password protection

Flagged by the Supabase security advisor. Dashboard → Authentication →
Password settings → enable the HaveIBeenPwned check.

Low priority while sign-in is Google-only: the only password account in
existence is `dev@local.test`, created by `scripts/dev-session.mjs` against the
local stack. It becomes real the moment any password path ships.

---

## Decisions, not dashboard steps

Recorded here so they stop being re-derived. Both came out of the security
advisor after the Phase 3 push.

**`creator_stats` and `creator_verification` are SECURITY DEFINER views** (2
advisor ERRORs). Not reflexively switched to `security_invoker`:
`creator_verification` exists specifically to expose verification status
*without* the OAuth tokens sitting beside it in `youtube_connections`, so
definer may be the point rather than the bug. Read both view definitions and the
policies behind them before changing either.

**The `avatars` bucket has a broad SELECT policy** allowing any client to list
every object in it. Public URL access does not need that policy at all. It is
production behaviour that predates this work, so it was not changed silently —
but it is a real over-exposure and worth closing.
