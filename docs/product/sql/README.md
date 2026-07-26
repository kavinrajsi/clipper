# Phase 1 migrations — staged, not applied

These files are **not** in `supabase/migrations/`. Dropping them there means the next `supabase db push` executes them, which is a decision for you to make deliberately rather than a side effect of reading a spec.

## To apply

Review, then move each file in order into `supabase/migrations/` with a real timestamp prefix:

```bash
# from the repo root
for f in 01-marketplace 02-hiring 03-collaboration 04-monetisation; do
  cp "docs/product/sql/${f}.sql" \
     "supabase/migrations/$(date -u +%Y%m%d%H%M%S)_${f#*-}.sql"
  sleep 1   # distinct timestamps
done

supabase db push
```

Or generate them one at a time with `supabase migration new <name>` and paste the contents in — which is the workflow the project should converge on.

**Test against a local stack first** (`supabase start`), not the live project. See [`../../supabase.md`](../../supabase.md) for local setup — note that doc's claim that `supabase/` doesn't exist is stale; it does, with two committed migrations.

## Order matters

| File | Contents | Depends on |
|---|---|---|
| `01-marketplace.sql` | Public profiles, portfolio, reviews, saves, follows, creator stats | — |
| `02-hiring.sql` | Campaign visibility, invites, proposals. **Fixes the broken `campaigns` RLS policy.** | `01` (portfolio for attachments) |
| `03-collaboration.sql` | Notifications, preferences, activity events | — |
| `04-monetisation.sql` | Commission columns | — |

## Conventions followed

Every policy matches one of the three patterns already in use:

1. **Owner-only** — `to authenticated using ((select auth.uid()) = user_id)`
2. **Cross-user `exists()`** — join to prove a relationship
3. **Service-role only** — no client insert policy at all; writes go through `createAdminClient()`

RLS is force-enabled on new public tables by the existing `rls_auto_enable()` event trigger. The explicit `enable row level security` lines below are redundant but kept for readability.

## Razorpay sandbox verification — RUN 2026-07-26

**Result: Route is not enabled on the account.** Auth works, core payments work, every Route endpoint returns "URL not found". Details and consequences in [`../08-monetisation.md`](../08-monetisation.md).

Re-run the steps below once Razorpay support has enabled Route, to answer the questions the docs leave open. Each is a distinct pass/fail.

Run the committed probe first — it reports which Razorpay products are enabled:

```bash
npm run razorpay:probe
```

It reads test keys from `.env.local`, refuses to run against a live key, and
creates nothing. Then work through the individual questions below.

Set up once (test-mode keys only — never live):

```bash
export RZP=<test_key_id>:<test_key_secret>
```

**1. Is Direct Transfers activated on the account?** This is the gating question.

```bash
curl -u "$RZP" -X POST https://api.razorpay.com/v1/transfers \
  -H 'Content-Type: application/json' \
  -d '{"account":"acc_XXXXXXXX","amount":10000,"currency":"INR"}'
```

A `BAD_REQUEST_ERROR` mentioning the feature not being enabled means it needs a support request. Success means the wallet model is unblocked.

**2. Can a direct transfer be held after creation?** Escrow depends on this.

```bash
curl -u "$RZP" -X PATCH https://api.razorpay.com/v1/transfers/trf_XXXXXXXX \
  -H 'Content-Type: application/json' \
  -d '{"on_hold":true}'
```

Then re-fetch it and confirm `on_hold` is actually `true` and `settlement_status` has not moved.

**3. How wide is the create-then-hold race?** Time the gap between step 1 and step 2, then check whether the transfer settled. Razorpay's docs warn that a transfer held *after* its settlement cycle elapsed settles immediately — establish empirically that a same-request PATCH is safe.

**4. Can you still transfer from a settled payment?** Only matters for the FIFO fallback. Take a captured test payment older than the settlement cycle and attempt `POST /v1/payments/{id}/transfers`. Expect either success or an insufficient-balance error — the answer decides whether fallback (1) is viable.

**5. Linked-account cooling period.** Docs state 24 hours before a new linked account can receive transfers. Confirm, because it affects a creator's first payout and should be surfaced during payout-account onboarding.

Record the answers in [`../08-monetisation.md`](../08-monetisation.md) — several design choices there are currently written against assumptions rather than observations.

## Before you run these

- **`fee_bearer` is decided: `'brand'`.** The brand funds budget + fee; the creator receives the full advertised rate. `04-monetisation.sql` defaults to this.
- **`04-monetisation.sql` replaces per-campaign funding entirely.** `fund` / `verify` become wallet top-up routes, `approve` writes ledger rows and releases the reservation, and the webhook credits a wallet instead of marking a campaign funded. `campaigns.funding_status` is deprecated but kept through the transition.
- **`04-monetisation.sql` is blocked on two answers and must not be run yet.** It implements a prepaid wallet: brands top up, campaigns reserve, fee is 5% of actual payouts, unused balance refunds in full. Two open items gate it — a Razorpay Route source-payment constraint that could invalidate the whole model, and an RBI prepaid-instrument question. Both are documented at the top of the file.
- **The other three migrations are independent of it** and can ship on their own.
- **The fee is 5%**, stored in `platform_settings` so super admin can change it without a migration.
- **`01-marketplace.sql` grants the `anon` role select access** on public creator profiles. That's the first genuinely public data in the system and should be a reviewed decision, not a default.
