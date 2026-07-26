# Monetisation

**Phase 1:** platform commission.
**Phase 4:** subscription plans, AI credits.
**Phase 5:** enterprise, agencies, featured placements.

## Reuse triage

| Already built | Extend this | Genuinely new |
|---|---|---|
| **`createHeldTransfer(paymentId, accountId, amount)`** (`src/lib/razorpay.js:112`) — transfers only `amount`; the remainder stays in the platform's Razorpay account | Source `paymentId` from the wallet top-up instead of the campaign. **This is the risky part — see the warning below** | — |
| `createOrder()` + the `fund` / `verify` route pair | Becomes the wallet top-up flow. Order creation and signature verification carry over unchanged | `/api/wallet/*` |
| Payout computation in `/api/payments/submissions/[id]/approve/route.js` | Add fee arithmetic + ledger writes; extract to `src/lib/payouts.js` | — |
| `campaigns.funding_status` + the `active ⇒ paid` DB constraint | Replaced by a reserved-balance check | `wallet_reservations` |
| Razorpay webhook HMAC handler | `payment.captured` credits a wallet instead of funding a campaign | — |
| `campaign_payouts` | Add `platform_fee_amount` for the audit trail | — |
| `ai_jobs.credits_charged` (from [`03-ai.md`](./03-ai.md)) | The metering hook | `ai_credit_ledger` |
| `workspaces.plan` (from [`04-workspace.md`](./04-workspace.md)) | Entitlement flag | `plan_entitlements` |
| `AdminPayoutsTable` | Add fee columns | `brand_wallets`, `wallet_transactions`, `invoices` |

---

## 1. Wallet model + commission on spend

**Phase 1.** The revenue model, and a change to how funding works.

### Problem

The platform takes 0%. Every campaign runs at a pure loss against Razorpay fees, hosting, and eventually AI costs.

But the funding model has its own problem, and the two are best solved together. Today a brand funds each campaign separately for its full budget, and per-view campaigns almost always underspend — you fund the ceiling and pay for the actual. That leaves money stranded per campaign with no refund path, and forces a fresh payment ceremony for every campaign.

### DECIDED: the model

**The brand funds a balance, not a campaign.** Campaigns draw from it. Fee is charged only when work is actually paid for. Anything unused comes back in full.

```
Brand tops up ₹100,000              → no fee charged. Balance ₹100,000.

Campaign A runs, creator earns ₹40,000
  → creator receives ₹40,000        (full advertised rate — brand bears the fee)
  → platform fee 5% of ₹40,000      = ₹2,000
  → balance debited ₹42,000
  → INVOICE issued for the ₹2,000 fee
  → Balance ₹58,000

Campaign B runs, creator earns ₹20,000
  → creator receives ₹20,000
  → platform fee                    = ₹1,000
  → balance debited ₹21,000
  → INVOICE issued for the ₹1,000 fee
  → Balance ₹37,000

Brand withdraws ₹37,000             → refunded in full, no deduction.
```

### Why this is better than what it replaces

This supersedes two earlier decisions — fee-on-funded-budget, and per-campaign funding. Both are gone. Three things improve:

**The effective rate is now exactly 5%.** Under fee-on-funded-budget, a brand funding ₹100,000 and spending ₹60,000 paid ₹5,000 — an 8.3% effective rate on real spend, rising further the more a campaign underdelivered. That misalignment is gone. The platform earns 5% of money that actually reached a creator, and nothing else.

**Refunds stop being a special case.** There is no "unspent campaign budget" to reconcile, because campaigns never hold money — the wallet does. Withdrawal is just paying out a balance, which is one code path instead of a per-campaign close-out job.

**Funding stops being friction.** A brand tops up once and runs campaigns until the balance runs down. No payment ceremony per campaign, and no reason to defensively undersize a budget.

### ⚠ Sandbox result: Route is not enabled on the account at all

Probed against the test keys in `.env.local` on 2026-07-26. Auth works and the account is live with real test data — but **every Route endpoint is unreachable**:

| Endpoint | Result |
|---|---|
| `GET /v1/payments?count=1` | **200** — returns a real captured payment |
| `GET /v1/settlements?count=1` | **200** — returns a real settlement |
| `GET /v2/accounts` (linked accounts) | **404** `no Route matched with those values` |
| `GET /v1/transfers` | **400** `The requested URL was not found on the server` |
| `POST /v1/transfers` (direct transfer) | **400** same |
| `GET /v1/payments/{id}/transfers` | **400** same |
| `POST /v1/payments/{id}/transfers` | **400** same |

Core payments work. Every Route surface — linked accounts, payment-sourced transfers, direct transfers — returns "URL not found", which is what Razorpay returns when a product is not provisioned on the account.

**This is larger than the wallet question. It means the payout half of the existing product has never been able to run.** `createLinkedAccount()` and `createHeldTransfer()` both target endpoints that 400 on this account. Campaign *funding* works, because orders and payments are core API. Creator *payouts* cannot have succeeded.

`AGENTS.md` attributes this to placeholder keys causing 401s. That's not what's happening — authentication succeeds. The keys are real; the Route product isn't enabled.

**Action, before any of this or any payout work: raise a Razorpay support request to enable Route** on both test and live accounts, and ask for Direct Transfers in the same request (it's separately on-demand — see below). Nothing in this document is testable until that lands.

### The source-payment problem, and its solution

**The problem.** Route transfers are normally sourced from a specific payment. Verified in the code: `approve/route.js:110` calls `createHeldTransfer(campaign.razorpay_payment_id, ...)`, and `createHeldTransfer` (`src/lib/razorpay.js:112`) calls `client.payments.transfer(paymentId, ...)`. That works today because each campaign owns its payment. A wallet would need every payout across every campaign to come out of one top-up payment, months later.

**The solution: Route's Direct Transfers API.** Razorpay documents a third transfer method alongside from-orders and from-payments — [Direct Transfers](https://razorpay.com/docs/api/payments/route/direct-transfers/), `POST /v1/transfers`, which *"[transfers] funds directly from your account balance to the Linked Accounts."* No source payment. Parameters are `account`, `amount`, `currency`, and optional `notes`.

This is exactly the primitive a wallet needs, and it removes the blocker.

**Three caveats that shape the build:**

1. **It requires activation.** The docs state: *"This is an on-demand feature. Please raise a request with our Support team to get this feature activated on your Razorpay account."* **Raise this request now** — it has a lead time and everything else here depends on it.

2. **Direct Transfers cannot set `on_hold` at creation.** The parameter list is `account`, `amount`, `currency`, `notes` only — `on_hold` appears in the *response* but not the request. Escrow therefore becomes create-then-hold: create the transfer, then immediately PATCH it via [Modify Settlement Hold](https://razorpay.com/docs/api/payments/route/modify-settlement-hold/).

3. **Create-then-hold has a race.** Razorpay's own example: a transfer created unheld and set to `on_hold` later *"the settlement for that transfer happens immediately"* once the settlement cycle has elapsed. For a fresh transfer PATCHed within the same request you should win comfortably against a T+2 schedule — but it is a window, and it is a window on the escrow guarantee that protects both sides of the marketplace.

   Worth asking Razorpay support two things when you raise the activation request: whether `on_hold` can be enabled at creation for direct transfers, and whether linked accounts can be placed on a manual or long settlement schedule so the hold window is not load-bearing.

**Fallbacks if Direct Transfers can't be activated:**

1. **Top-ups as multiple payments, drawn FIFO.** The wallet is a ledger over several payment IDs; each payout transfers from the oldest payment with sufficient residual, using the existing payment-sourced call. Same user experience, more bookkeeping. Note the documented error *"The sum of amount requested for transfer is greater than the captured amount"* — the per-payment cap is the captured amount, which is what makes FIFO tracking necessary.
2. **Keep per-campaign funding**, move the fee to actual payouts, add a refund-at-close job. Drops the wallet UX but fixes the effective-rate problem and adds no new regulatory surface.

**Other verified constraints:** minimum transfer is 100 paise (₹1); INR only; linked accounts have a *"cooling period of 24 hours"* before they can receive transfers — which matters for a creator's first payout and should be surfaced during payout-account onboarding.

**Still unverified, and only a sandbox run will settle it:** whether a *settled* payment can still be transferred from, and the real behaviour of the create-then-hold window. See the verification plan in [`sql/README.md`](./sql/README.md).

### ⚠ The regulatory question

Holding a prepaid customer balance is materially different from escrowing a specific campaign payment. In India, taking money in advance and holding it as a spendable balance can engage RBI prepaid-payment-instrument rules. Per-campaign escrow sidesteps that far more cleanly than a general-purpose wallet does.

I'm flagging this, not advising on it — it needs someone who actually practises in this area, before launch rather than after. It may be that structuring the balance as *funds held against a specific brand's campaigns* rather than a general wallet resolves it, but that's a question for counsel.

### Reservations: stopping over-commitment

A balance is spendable by more than one campaign, so the balance alone isn't enough. A brand with ₹100,000 who activates two ₹60,000 campaigns has promised ₹120,000 they don't have.

Three numbers, not one:

| | Meaning |
|---|---|
| `balance` | Money topped up, minus everything spent |
| `reserved` | Sum of remaining budgets on active campaigns |
| `available` | `balance − reserved` — what can fund a new campaign or be withdrawn |

Activating a campaign reserves its budget and fails if `available` is short. A payout debits `balance` and releases the same amount from `reserved`. Closing a campaign releases whatever reservation is left.

**This replaces the existing `funding_status` flow.** The DB constraint tying `status = 'active'` to `funding_status = 'paid'` becomes a check against reserved balance instead.

### Invoicing

One invoice per campaign, issued at campaign close, consolidating every fee charged against that campaign. That matches "if a campaign runs, generate the bill" and avoids an invoice per payout, which would be unmanageable for a campaign with ten creators.

**GST is not optional here.** Platform commission is a supply of services in India, so an invoice needs sequential numbering, both parties' GSTIN, an SAC code, place of supply, and the tax split. The schema below carries those fields; the rates and treatment need an accountant, not me.

Note the consequence: if GST applies at 18%, a ₹2,000 fee bills as ₹2,360 and the wallet debits ₹42,360, not ₹42,000. Confirm before implementing — it changes the arithmetic in the approve route.

### Schema

```sql
-- One balance per brand. Becomes workspace-scoped in Phase 2.
create table public.brand_wallets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  currency text not null default 'INR',
  created_at timestamptz not null default now()
);

-- Append-only ledger. Balance is derived, never stored as a mutable column,
-- so concurrent payouts cannot race and every rupee is auditable.
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.brand_wallets(id) on delete cascade,
  kind text not null check (kind in
    ('top_up','payout_debit','fee_debit','tax_debit','refund','adjustment')),
  amount numeric not null,          -- signed: + credits, - debits
  balance_after numeric not null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  payout_id uuid references public.campaign_payouts(id) on delete set null,
  invoice_id uuid,
  razorpay_payment_id text,         -- top-ups: the source payment for Route
  razorpay_refund_id text,
  created_at timestamptz not null default now()
);

-- Budget held against active campaigns, released as it is spent.
create table public.wallet_reservations (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  wallet_id uuid not null references public.brand_wallets(id) on delete cascade,
  reserved_amount numeric not null check (reserved_amount >= 0),
  released_amount numeric not null default 0 check (released_amount >= 0),
  status text not null default 'active'
    check (status in ('active','released','cancelled')),
  created_at timestamptz not null default now(),
  check (released_amount <= reserved_amount)
);

-- Tax invoices for platform fees.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.brand_wallets(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  invoice_number text not null unique,
  fee_amount numeric not null,
  tax_amount numeric not null default 0,
  total_amount numeric not null,
  place_of_supply text,
  buyer_gstin text,
  seller_gstin text,
  sac_code text,
  status text not null default 'issued'
    check (status in ('draft','issued','cancelled')),
  issued_at timestamptz not null default now(),
  pdf_path text
);
```

`wallet_transactions` is the spine. Balance, reserved, and available are all derived from it plus `wallet_reservations` — no denormalised counter to drift.

Withdrawals must check `available`, not `balance`, or a brand withdraws money already promised to an active campaign.

### API changes

| Route | Method | Purpose |
|---|---|---|
| `/api/wallet` | `GET` | Balance, reserved, available, recent ledger |
| `/api/wallet/top-up` | `POST` | Razorpay order for a top-up — reuses `createOrder()` unchanged |
| `/api/wallet/top-up/verify` | `POST` | Signature check, credit the ledger — mirrors the existing campaign verify route |
| `/api/wallet/withdraw` | `POST` | Refund `available` to source; blocked if `reserved > 0` beyond it |
| `/api/campaigns/[id]/activate` | `POST` | Reserve budget, activate — replaces per-campaign funding |
| `/api/invoices/[id]` | `GET` | Fetch or download an invoice |

**What changes in existing code:**

- `campaigns/[id]/fund` and `/verify` → become the wallet top-up routes. The Razorpay order and signature-verification logic transfer over essentially unchanged; only what gets credited differs.
- `submissions/[id]/approve` → after computing `amount`, also compute the 5% fee, write three ledger rows (payout debit, fee debit, tax debit), release the reservation, and create the transfer via **Direct Transfers** rather than from `campaign.razorpay_payment_id`.
- `src/lib/razorpay.js` → `createHeldTransfer()` gains a sibling. Direct Transfers can't set `on_hold` at creation, so the new helper is two calls, not one:

  ```js
  // POST /v1/transfers  — no source payment, draws from account balance
  export async function createDirectTransfer(accountId, amount) {
    const client = getRazorpayClient();
    return client.transfers.create({
      account: accountId,
      amount: Math.round(amount * 100),
      currency: "INR",
    });
  }

  // Immediately hold it. See the settlement race noted above — PATCH in the
  // same request, never on a queue or a later job.
  export async function holdTransfer(transferId) {
    const client = getRazorpayClient();
    return client.transfers.edit(transferId, { on_hold: true });
  }
  ```

  `releaseTransferHold()` is unchanged — it already does `edit(id, { on_hold: false })`, which is the same endpoint.
- `webhook` → the `payment.captured` handler credits a wallet instead of marking a campaign funded.
- `campaigns.razorpay_order_id` / `razorpay_payment_id` / `funding_status` → deprecated. Keep the columns through the transition; stop reading them once `wallet_reservations` is authoritative.

### Permissions & edge cases

Wallet and ledger are owner-only (RLS pattern 1). `wallet_transactions` gets **no client insert policy at all** — every write goes through the admin client after a verified Razorpay event, exactly like `campaign_payouts`. A client-writable balance ledger is a licence to print money.

- **Concurrent payouts** against one wallet can race on `balance_after`. Compute it inside a transaction with `select … for update` on the wallet row, or derive balance on read and drop the column.
- **Insufficient balance at approval.** A per-view payout is computed from live view counts and can exceed the reservation. Block the approval with a clear message and prompt a top-up — never create a transfer the wallet can't cover.
- **Withdrawal while campaigns are active** must be capped at `available`, not `balance`.
- **Refund destination.** Razorpay refunds return to the original payment method. A wallet funded across several top-ups needs refunds split across those payments, which is the same FIFO bookkeeping as fallback (1) above.
- **Minimum fee floor.** 5% of a ₹200 payout is ₹10, below Razorpay's per-transfer cost — the platform loses money on that transfer. A minimum payout threshold is a launch requirement.
- **Rounding** compounds across many small per-view payouts. Round to 2 decimals at each step and reconcile against Razorpay's records, never against recomputation.
- **Failed transfers** must not debit the fee. Fee is charged on a successful transfer, and reversed if a transfer later fails.
- **Existing funded campaigns** need migrating: create a wallet per brand, credit the unspent portion of each funded campaign, and carry the original `razorpay_payment_id` onto the ledger row so future transfers have a valid source.

### Future improvements

Auto top-up at a threshold; per-campaign spend caps; tiered rates falling with lifetime volume; reduced rates for repeat brand-creator pairs; consolidated monthly invoicing for high-volume brands.

---

## 2. Subscription plans

**Phase 4.** Condensed.

Commission alone couples revenue to transaction volume, which is lumpy and punishes exactly the power users you want. Subscriptions add predictable revenue and a natural entitlement axis for AI features, which have real marginal cost.

Indicative shape — validate against actual usage before committing:

| | Free | Pro | Agency | Enterprise |
|---|---|---|---|---|
| Campaigns | 1 active | Unlimited | Unlimited | Unlimited |
| Team seats | 1 | 5 | 25 | Custom |
| Workspaces | 1 | 1 | Multi-client | Multi-client |
| AI credits/mo | Trial | Included | Larger | Custom |
| Commission | Standard | Reduced | Reduced | Negotiated |
| Support | Community | Email | Priority | Dedicated |
| SSO, audit log | — | — | — | Yes |

The lever that matters: **a lower commission rate on higher plans.** It makes the upgrade arithmetic self-evident for high-volume brands and aligns the platform with their growth.

```sql
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  plan text not null,
  status text not null check (status in
    ('trialing','active','past_due','cancelled','expired')),
  razorpay_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.plan_entitlements (
  plan text primary key,
  max_active_campaigns int,
  max_seats int,
  monthly_ai_credits int,
  commission_percent numeric not null,
  features jsonb not null default '{}'
);
```

Entitlements live in a table, not in code, so pricing changes don't require a deploy.

Razorpay Subscriptions handles the recurring billing; the existing webhook handler (`/api/payments/webhook`) extends with subscription events, reusing the HMAC verification already there.

Watch: downgrades with more resources than the new plan allows (block new creation, don't destroy existing); `past_due` grace periods; proration; and keeping entitlement checks server-side — a client-side feature gate is a suggestion, not a limit.

---

## 3. AI credits

**Phase 4**, alongside the AI layer.

AI has genuine marginal cost, so it can't be flat-rate at the low tiers. `ai_jobs.credits_charged` from [`03-ai.md`](./03-ai.md) is already the metering hook; this adds the ledger:

```sql
create table public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delta numeric not null,
  reason text not null check (reason in
    ('plan_grant','purchase','job_charge','refund','adjustment')),
  ai_job_id uuid references public.ai_jobs(id) on delete set null,
  balance_after numeric not null,
  created_at timestamptz not null default now()
);
```

Append-only ledger rather than a mutable balance column — balance is derivable, disputes are answerable, and concurrent charges can't race.

Principles worth committing to: **charge on success, never on submission**; show the cost before the action, not after; let plan credits expire monthly but purchased credits roll over; and price in units a user can reason about ("1 clip analysis"), not tokens.

---

## 4. Enterprise, agencies, featured placements

**Phase 5.** Condensed.

**Enterprise** — SSO/SAML, audit logs (the append-only `activity_events` table already supports this), custom contracts and MSAs, invoiced billing rather than card capture, dedicated support, and true conversion attribution from [`07-analytics.md`](./07-analytics.md). Enterprise is mostly compliance and procurement work, not product surface.

**Agencies** — multi-client workspaces under one billing entity, client-scoped permissions, white-labelled brand-facing views, and consolidated reporting. Agencies are the highest-leverage segment in a creator marketplace because one signup brings a dozen brands and a standing budget. The workspaces model from [`04-workspace.md`](./04-workspace.md) is what makes this possible at all — a parent-organisation layer above workspaces is the remaining piece.

**Featured placements** — promoted creators in discovery, promoted campaigns in the creator feed. High margin and easy to build once discovery exists, with one hard rule: **paid placement must be visibly labelled and must never contaminate the leaderboard or the verified-performance ranking.** The trust model from [`01-marketplace.md`](./01-marketplace.md) is the durable asset here; renting it out for ad revenue trades a moat for a rounding error.

```sql
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('creator','campaign')),
  subject_id uuid not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  placement text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  amount_paid numeric not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','active','completed','cancelled'))
);
```

---

## Revenue model summary

| Stream | Phase | Predictability | Margin |
|---|---|---|---|
| Commission on GMV | 1 | Variable | High |
| Subscriptions | 4 | Recurring | High |
| AI credits | 4 | Usage-based | Medium — real COGS |
| Featured placements | 5 | Variable | Very high |
| Enterprise contracts | 5 | Recurring | High |

Commission is the foundation and should carry the business alone for the first year. Everything else is leverage on an existing relationship, and none of it works if the core marketplace isn't liquid — which is why Phases 1–2 are trust and delivery rather than pricing.
