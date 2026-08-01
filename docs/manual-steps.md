# Manual steps

Things that cannot be fixed with a migration or a commit, because they live in
somebody else's dashboard. Each one is blocking something real, and each has
been discovered rather than assumed — the evidence is linked.

Delete an entry once it is done.

---

## 1. Ask Razorpay to enable Route **and** Direct Transfers — ⏸ ON HOLD

**On hold by decision, 2026-08-01. Do not send without checking first.** The
draft below is kept ready, not abandoned — everything in it stays accurate.

**Consequences while it is held**, so nobody rediscovers these as bugs:

- **Creator payouts cannot run at all.** `createLinkedAccount()` and
  `createHeldTransfer()` in `src/lib/razorpay.js` target endpoints that 400 on
  this account. Brands can fund a campaign; nobody can be paid out of it. This
  is a product-level gap, not a code defect — do not debug that code assuming it
  once worked.
- Phase 4's wallet and subscriptions stay blocked, along with
  `docs/product/sql/04-monetisation.sql`.
- Underspend still has no path back to the brand. Refunds *do* work (core API,
  partial refunds supported), so that is buildable today independently of this
  ticket — see the gaps list in `AGENTS.md`.
- Anything that needs a released payout stays untestable end to end, including
  ratings and reviews, which are gated on one at the RLS level.

**Blocks (when unheld):** every payout. Also the wallet, subscriptions, and
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

## 2. Add the Sarvam and cron environment variables

**Blocks:** transcription (Phase 3 slice 3) end to end, and everything after it —
highlight detection and brief generation both read the transcript.

The code is written and the routes are live, but four variables do not exist. The
transcribe route returns **503 "Transcription isn't configured yet"** until the
first one is set, which is deliberate — an unconfigured pipeline should refuse
rather than half-run.

| Variable | What it is |
|---|---|
| `SARVAM_API_KEY` | Sarvam dashboard → API key. ₹30/hr, ₹45/hr with diarization (we use diarization). ₹1,000 free credits. |
| `SARVAM_CALLBACK_TOKEN` | Any long random string you choose. Sarvam sends it back as `X-SARVAM-JOB-CALLBACK-TOKEN`; the webhook compares it in constant time. |
| `NEXT_PUBLIC_SITE_URL` | Public origin, so Sarvam knows where to call back. Without it the webhook is simply not registered and the cron poller does all the work — slower, still correct. |
| `CRON_SECRET` | Any long random string. `/api/cron/ai-jobs` requires `Authorization: Bearer <it>`. Vercel Cron sends this automatically once the variable exists on the project. |

**Then run `npm run sarvam:probe`.** This matters more than usual:
`src/lib/ai/providers/sarvam.js` was written against Sarvam's published docs and
their official skills repo and **has never been executed** — every request and
response shape in it is a claim. The probe creates a real ten-second job (a tone
it generates itself, a few paise) and walks the whole flow: init → upload URL →
PUT with `Content-Length` → start → poll → download. Each failure it prints is a
place the client guessed wrong.

```bash
npm run sarvam:probe                 # synthesised audio
npm run sarvam:probe -- ./clip.mp4   # also answers the MP4 question
```

**Run it with a real video file at least once.** Whether Sarvam accepts an MP4
directly is undocumented and decides a real architectural question: if it does,
`/studio` needs no change; if it does not, ffmpeg audio extraction goes into
`prepareAudio()` in `src/lib/ai/providers/sarvam.js` and nowhere else — that
function exists as a seam for exactly this, and currently does nothing.

## 3. Raise the hosted project's storage upload limit

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

## 4. Register the local Google OAuth redirect URI

**Blocks:** signing into the local stack through the real login screen.

Google Cloud console → the Supabase Auth OAuth client → add
`http://127.0.0.1:54321/auth/v1/callback` alongside the production one.

Not urgent: `npm run dev:session` sidesteps it for server-rendering checks. It
is needed for testing client components, form submits and realtime, which that
script cannot cover.

Note the YouTube connector uses a *separate* OAuth client from Supabase Auth —
see "Auth and roles" in `AGENTS.md`.

---

## 5. Enable leaked-password protection

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
