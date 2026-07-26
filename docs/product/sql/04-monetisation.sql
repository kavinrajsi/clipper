-- Phase 1 — Wallet model + commission on spend
-- Spec: docs/product/08-monetisation.md
--
-- THE MODEL (decided):
--   Brand tops up a balance. No fee at top-up.
--   A campaign reserves budget from that balance to go active.
--   When a creator is paid, the wallet is debited (payout + 5% fee + tax)
--     and an invoice is issued for the fee.
--   Unused balance is refunded in full, with no deduction.
--
-- ============================================================================
-- DO NOT RUN THIS UNTIL TWO THINGS ARE ANSWERED
-- ============================================================================
--
-- 1. RAZORPAY ROUTE IS NOT ENABLED ON THE ACCOUNT.
--    Probed with the test keys on 2026-07-26: /v1/payments and /v1/settlements
--    return 200, but EVERY Route endpoint returns "The requested URL was not
--    found on the server" — /v2/accounts, /v1/transfers, and
--    /v1/payments/{id}/transfers alike.
--    This is bigger than the wallet model: createLinkedAccount() and
--    createHeldTransfer() in the CURRENT codebase target those same endpoints,
--    so creator payouts have never been able to run. Funding works because
--    orders/payments are core API.
--    → RAISE A RAZORPAY SUPPORT REQUEST TO ENABLE ROUTE (test + live) FIRST.
--      Ask for Direct Transfers in the same request — it is separately
--      on-demand ("Please raise a request with our Support team").
--      Also ask: (a) can on_hold be set at creation for direct transfers?
--      (b) can linked accounts use a manual/long settlement schedule?
--    Direct transfers accept only account/amount/currency/notes — no on_hold —
--    so escrow becomes create-then-PATCH, which has a settlement race.
--
-- 2. RBI PREPAID-INSTRUMENT QUESTION — holding a spendable customer balance is
--    materially different from escrowing one campaign payment, and may engage
--    prepaid-payment-instrument rules. Needs counsel, not a code comment.
--
-- ============================================================================
--
-- ALSO CONFIRM:
--   - GST treatment of the platform fee. If 18% applies, a 2,000 fee bills at
--     2,360 and the wallet debits accordingly — this changes the approve-route
--     arithmetic. Fields are provided below; rates need an accountant.
--   - The minimum payout threshold. 5% of a 200 payout is 10, below Razorpay's
--     per-transfer cost, so small payouts lose money.

-- ---------------------------------------------------------------------------
-- 1. Platform-wide settings
--
-- Current default rate lives in a row, not a column default, so super admin
-- can change it without a migration or a deploy.
-- ---------------------------------------------------------------------------

create table if not exists public.platform_settings (
  id boolean primary key default true,
  default_fee_percent numeric not null default 5.0
    check (default_fee_percent >= 0 and default_fee_percent <= 100),
  tax_percent numeric not null default 0
    check (tax_percent >= 0 and tax_percent <= 100),
  min_payout_amount numeric not null default 0,
  seller_gstin text,
  invoice_prefix text not null default 'CLP',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (id)
);

insert into public.platform_settings (id) values (true)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

-- Readable by everyone: brands must see the fee before they spend.
create policy "Platform settings are readable"
  on public.platform_settings for select
  to anon, authenticated
  using (true);

-- No write policy. Changes go through an API route that checks isSuperAdmin()
-- and writes via createAdminClient(). isSuperAdmin compares user.email to the
-- SUPER_ADMIN_EMAIL env var, which Postgres cannot see — so the check belongs
-- in the application, not in RLS.

-- ---------------------------------------------------------------------------
-- 2. Wallets
--
-- One per brand now; becomes workspace-scoped in Phase 2 (04-workspace.md).
-- ---------------------------------------------------------------------------

create table if not exists public.brand_wallets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  currency text not null default 'INR',
  created_at timestamptz not null default now()
);

alter table public.brand_wallets enable row level security;

create policy "Owners read their own wallet"
  on public.brand_wallets for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- No client insert/update: wallets are created server-side on first top-up.

-- ---------------------------------------------------------------------------
-- 3. Ledger
--
-- Append-only. Balance is DERIVED from this table, never stored as a mutable
-- column, so concurrent payouts cannot race and every rupee is auditable.
--
-- Pattern 3 (service-role only) for writes: deliberately NO client insert
-- policy. A client-writable balance ledger is a licence to print money.
-- ---------------------------------------------------------------------------

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.brand_wallets(id) on delete cascade,
  kind text not null check (kind in
    ('top_up','payout_debit','fee_debit','tax_debit','refund','adjustment')),
  -- Signed: positive credits the wallet, negative debits it.
  amount numeric not null check (amount <> 0),
  campaign_id uuid references public.campaigns(id) on delete set null,
  payout_id uuid references public.campaign_payouts(id) on delete set null,
  invoice_id uuid,
  -- Top-ups record the captured payment. Every later Route transfer must be
  -- sourced from one of these — see the constraint warning at the top.
  razorpay_payment_id text,
  razorpay_refund_id text,
  note text,
  created_at timestamptz not null default now(),
  -- Direction must match the kind, so a debit can never be written positive.
  check (
    (kind in ('top_up','refund') and amount > 0)
    or (kind in ('payout_debit','fee_debit','tax_debit') and amount < 0)
    or kind = 'adjustment'
  )
);

create index if not exists wallet_transactions_wallet_idx
  on public.wallet_transactions (wallet_id, created_at desc);

create index if not exists wallet_transactions_campaign_idx
  on public.wallet_transactions (campaign_id)
  where campaign_id is not null;

-- Top-up payments still holding transferable residual, oldest first. This is
-- the FIFO source list for Route transfers.
create index if not exists wallet_transactions_topup_idx
  on public.wallet_transactions (wallet_id, created_at)
  where kind = 'top_up';

alter table public.wallet_transactions enable row level security;

create policy "Owners read their own ledger"
  on public.wallet_transactions for select
  to authenticated
  using (
    exists (
      select 1 from public.brand_wallets w
      where w.id = wallet_transactions.wallet_id
        and w.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Reservations
--
-- A balance is spendable by more than one campaign, so balance alone is not
-- enough. Activating a campaign reserves its budget; payouts release it.
-- ---------------------------------------------------------------------------

create table if not exists public.wallet_reservations (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  wallet_id uuid not null references public.brand_wallets(id) on delete cascade,
  reserved_amount numeric not null check (reserved_amount >= 0),
  released_amount numeric not null default 0 check (released_amount >= 0),
  status text not null default 'active'
    check (status in ('active','released','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (released_amount <= reserved_amount)
);

create index if not exists wallet_reservations_wallet_active_idx
  on public.wallet_reservations (wallet_id)
  where status = 'active';

alter table public.wallet_reservations enable row level security;

create policy "Owners read their own reservations"
  on public.wallet_reservations for select
  to authenticated
  using (
    exists (
      select 1 from public.brand_wallets w
      where w.id = wallet_reservations.wallet_id
        and w.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Derived balances
--
-- balance   = sum of the ledger
-- reserved  = unreleased portion of active reservations
-- available = balance - reserved   ← what can fund a new campaign or withdraw
-- ---------------------------------------------------------------------------

create or replace view public.wallet_balances as
select
  w.id as wallet_id,
  w.owner_id,
  coalesce((
    select sum(t.amount) from public.wallet_transactions t
     where t.wallet_id = w.id
  ), 0) as balance,
  coalesce((
    select sum(r.reserved_amount - r.released_amount)
      from public.wallet_reservations r
     where r.wallet_id = w.id and r.status = 'active'
  ), 0) as reserved,
  coalesce((
    select sum(t.amount) from public.wallet_transactions t
     where t.wallet_id = w.id
  ), 0)
  - coalesce((
    select sum(r.reserved_amount - r.released_amount)
      from public.wallet_reservations r
     where r.wallet_id = w.id and r.status = 'active'
  ), 0) as available
from public.brand_wallets w;

-- Scalar subqueries, not joins: joining the ledger and reservations together
-- would fan out and multiply both sums.

-- WITHDRAWALS MUST CHECK `available`, NEVER `balance` — otherwise a brand
-- withdraws money already promised to an active campaign.

-- ---------------------------------------------------------------------------
-- 6. Invoices
--
-- One per campaign, issued at close, consolidating every fee charged against
-- that campaign. Platform commission is a supply of services in India, so
-- these are tax invoices, not receipts.
-- ---------------------------------------------------------------------------

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.brand_wallets(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  invoice_number text not null unique,
  fee_amount numeric not null check (fee_amount >= 0),
  tax_amount numeric not null default 0 check (tax_amount >= 0),
  total_amount numeric not null check (total_amount >= 0),
  place_of_supply text,
  buyer_gstin text,
  seller_gstin text,
  sac_code text,
  status text not null default 'issued'
    check (status in ('draft','issued','cancelled')),
  issued_at timestamptz not null default now(),
  pdf_path text
);

create index if not exists invoices_wallet_idx
  on public.invoices (wallet_id, issued_at desc);

alter table public.invoices enable row level security;

create policy "Owners read their own invoices"
  on public.invoices for select
  to authenticated
  using (
    exists (
      select 1 from public.brand_wallets w
      where w.id = invoices.wallet_id
        and w.owner_id = (select auth.uid())
    )
  );

-- Gapless sequential numbering. Tax invoice series must not have holes.
create sequence if not exists public.invoice_number_seq;

create or replace function public.next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text;
begin
  select invoice_prefix into prefix from public.platform_settings where id limit 1;
  return coalesce(prefix, 'CLP')
      || '-' || to_char(now(), 'YYYY')
      || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Campaign fee snapshot
--
-- Rate is snapshotted per campaign so changing the platform default never
-- retroactively alters an existing campaign's economics.
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists platform_fee_percent numeric not null default 5.0
    check (platform_fee_percent >= 0 and platform_fee_percent <= 100),
  add column if not exists wallet_id uuid references public.brand_wallets(id),
  add column if not exists closed_at timestamptz;

alter table public.campaign_payouts
  add column if not exists platform_fee_amount numeric
    check (platform_fee_amount is null or platform_fee_amount >= 0);

update public.campaign_payouts
   set platform_fee_amount = 0
 where platform_fee_amount is null;

-- Brands must not set their own rate. Enforced in the database rather than
-- trusted to a form or a route.
--
-- NOTE: the service-role client bypasses RLS but STILL FIRES TRIGGERS, so the
-- super admin path must be recognised explicitly here or it gets blocked too.

create or replace function public.guard_campaign_fee_percent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
begin
  begin
    jwt_role := (select auth.role());
  exception when others then
    jwt_role := null;
  end;

  if jwt_role = 'service_role' or (select auth.uid()) is null then
    return new;   -- super admin route, migration, or scheduled job
  end if;

  if tg_op = 'INSERT' then
    new.platform_fee_percent :=
      coalesce((select default_fee_percent from public.platform_settings where id limit 1), 5.0);
    return new;
  end if;

  if new.platform_fee_percent is distinct from old.platform_fee_percent then
    raise exception 'Platform fee can only be changed by a platform admin'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists campaigns_fee_guard on public.campaigns;
create trigger campaigns_fee_guard
  before insert or update on public.campaigns
  for each row execute function public.guard_campaign_fee_percent();

-- ---------------------------------------------------------------------------
-- 8. Revenue reporting for /admin
--
-- Revenue is recognised when a fee is actually charged — i.e. when a creator
-- was paid — not at top-up.
-- ---------------------------------------------------------------------------

create or replace view public.platform_revenue as
select
  date_trunc('month', t.created_at) as month,
  count(*)                          as fee_events,
  sum(-t.amount)                    as platform_fees
from public.wallet_transactions t
where t.kind = 'fee_debit'
group by 1
order by 1 desc;

create or replace view public.wallet_liability as
select
  w.id as wallet_id,
  w.owner_id,
  b.balance,
  b.reserved,
  b.available
from public.brand_wallets w
join public.wallet_balances b on b.wallet_id = w.id
where b.balance > 0;

revoke all on public.platform_revenue  from anon, authenticated;
revoke all on public.wallet_liability  from anon, authenticated;
-- Read via createAdminClient() from /admin only.

-- wallet_liability is the number to watch: it is customer money the platform
-- is holding, and it is refundable in full on demand.

-- ---------------------------------------------------------------------------
-- 9. Migration of existing funded campaigns
--
-- Each currently-funded campaign holds its own captured payment. Create a
-- wallet per brand, credit the UNSPENT portion, and carry the original
-- razorpay_payment_id onto the ledger row so future Route transfers have a
-- valid source payment.
--
-- Review the numbers before running. Uncomment deliberately.
-- ---------------------------------------------------------------------------

-- insert into public.brand_wallets (owner_id)
-- select distinct c.brand_id
--   from public.campaigns c
--  where c.funding_status = 'paid'
-- on conflict (owner_id) do nothing;
--
-- insert into public.wallet_transactions
--        (wallet_id, kind, amount, campaign_id, razorpay_payment_id, note)
-- select w.id,
--        'top_up',
--        c.budget - coalesce((
--          select sum(p.amount)
--            from public.campaign_payouts p
--            join public.campaign_applications ca on ca.id = p.application_id
--           where ca.campaign_id = c.id
--             and p.status <> 'failed'
--        ), 0),
--        c.id,
--        c.razorpay_payment_id,
--        'Migrated from per-campaign funding'
--   from public.campaigns c
--   join public.brand_wallets w on w.owner_id = c.brand_id
--  where c.funding_status = 'paid'
--    and c.budget - coalesce((
--          select sum(p.amount)
--            from public.campaign_payouts p
--            join public.campaign_applications ca on ca.id = p.application_id
--           where ca.campaign_id = c.id
--             and p.status <> 'failed'
--        ), 0) > 0;
