-- Platform commission. Phase 1, docs/product/00-roadmap.md.
--
-- The fee is charged when work is actually paid for, computed on what the
-- creator earns, and borne by the brand: the creator always receives the full
-- advertised rate. Realised by NOT transferring the fee — the remainder stays
-- in the platform's Razorpay account — so there is no second transfer call and
-- no reduced creator payout.
--
-- Scope note. docs/product/08-monetisation.md §1 specifies a wallet model
-- (brand_wallets, wallet_transactions, wallet_reservations, invoices) that
-- replaces per-campaign funding entirely. None of that is buildable yet: it
-- depends on Razorpay Direct Transfers, which is not enabled on this account
-- (see the probe table in that doc). What ships here is the roadmap's own
-- framing -- "an arithmetic change in the approve route" -- plus the audit
-- column the doc's reuse triage asks for.
--
-- The fee LOGIC is what the wallet model needs regardless: 5% of creator
-- earnings, brand-borne, charged on payment rather than on funding. When the
-- wallet lands, only the debit target changes -- campaign budget becomes
-- wallet balance.
--
-- NOT NULL DEFAULT 0 rather than nullable: payouts written before this
-- migration genuinely carried no fee, so 0 is the true value, and it keeps any
-- SQL-side sum from collapsing to null.

alter table public.campaign_payouts
  add column if not exists platform_fee_amount numeric not null default 0;

comment on column public.campaign_payouts.platform_fee_amount is
  'Platform commission on this payout, in INR. Charged to the brand on top of '
  'the creator amount, so budget consumed = amount + platform_fee_amount. '
  'Excludes GST, which is not yet applied -- see docs/product/08-monetisation.md.';

-- No RLS change needed: campaign_payouts has no client insert/update policy by
-- design (every write corresponds to a real Razorpay call and goes through the
-- admin client), and the existing brand-side select policy is row-level, so the
-- new column is exposed by it automatically.
