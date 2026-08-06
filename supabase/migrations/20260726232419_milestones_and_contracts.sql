-- Milestones and contracts.
--
-- A campaign was a single all-or-nothing payment. That works for one clip and
-- fails for a 10-clip package or a launch with staged deliverables: the brand
-- either pays everything up front or the creator works unpaid until the end.
-- Neither party does that with a stranger, so large engagements did not happen
-- here at all.
--
-- Funding stays whole-budget-up-front. Only the PAYOUT splits. That reuses the
-- funding flow untouched and keeps the creator's guarantee that the money
-- genuinely exists.
--
-- NOTE: the payout half cannot be exercised end to end until Razorpay Route is
-- enabled on the account, so this is verified at the database level only.

create table if not exists public.campaign_milestones (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  description text,
  amount numeric not null check (amount > 0),
  deliverable_count int not null default 1 check (deliverable_count > 0),
  due_date date,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists campaign_milestones_campaign_idx
  on public.campaign_milestones (campaign_id, position);

alter table public.campaign_milestones enable row level security;

drop policy if exists "Workspace members manage milestones" on public.campaign_milestones;
create policy "Workspace members manage milestones"
  on public.campaign_milestones for all to authenticated
  using (public.is_campaign_workspace_member(campaign_milestones.campaign_id))
  with check (public.is_campaign_workspace_member(campaign_milestones.campaign_id));

-- Applicants need to see what they are being paid against.
drop policy if exists "Applicants read milestones" on public.campaign_milestones;
create policy "Applicants read milestones"
  on public.campaign_milestones for select to authenticated
  using (public.has_applied_to_campaign(campaign_milestones.campaign_id));

-- Milestone amounts must not exceed the funded budget. Over-committing creates
-- a payout that can never be paid.
create or replace function public.tg_guard_milestone_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare total numeric; budget numeric;
begin
  select c.budget into budget from public.campaigns c where c.id = new.campaign_id;
  if budget is null then return new; end if;

  select coalesce(sum(m.amount), 0) into total
    from public.campaign_milestones m
   where m.campaign_id = new.campaign_id
     and m.id is distinct from new.id;

  if total + new.amount > budget then
    raise exception 'Milestones total %, which exceeds the campaign budget of %',
      total + new.amount, budget
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists guard_milestone_total on public.campaign_milestones;
create trigger guard_milestone_total
  before insert or update on public.campaign_milestones
  for each row execute function public.tg_guard_milestone_total();

-- ---------------------------------------------------------------------------
-- One payout per application becomes one payout per application PER MILESTONE.
--
-- approve/route.js upserts against this and MUST move to the new target in the
-- same deploy, or approvals break. See the follow-up migration
-- 20260726232519, which replaces this index with a NULLS NOT DISTINCT version
-- that PostgREST's onConflict can actually name.
-- ---------------------------------------------------------------------------

alter table public.campaign_payouts
  add column if not exists milestone_id uuid
    references public.campaign_milestones(id) on delete set null;

alter table public.campaign_payouts
  drop constraint if exists campaign_payouts_application_id_key;

create unique index if not exists campaign_payouts_application_milestone_key
  on public.campaign_payouts (
    application_id,
    coalesce(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- Contracts: a frozen snapshot of what was agreed.
--
-- When a dispute arises, "what was actually agreed" should have exactly one
-- answer, so terms_snapshot is immutable once either side accepts.
-- ---------------------------------------------------------------------------

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique
    references public.campaign_applications(id) on delete cascade,
  terms_snapshot jsonb not null,
  brand_accepted_at timestamptz,
  clipper_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.contracts enable row level security;

drop policy if exists "Parties read the contract" on public.contracts;
create policy "Parties read the contract"
  on public.contracts for select to authenticated
  using (
    exists (
      select 1 from public.campaign_applications ca
       where ca.id = contracts.application_id
         and (
           ca.clipper_id = (select auth.uid())
           or public.is_campaign_workspace_member(ca.campaign_id)
         )
    )
  );

drop policy if exists "Parties accept the contract" on public.contracts;
create policy "Parties accept the contract"
  on public.contracts for update to authenticated
  using (
    exists (
      select 1 from public.campaign_applications ca
       where ca.id = contracts.application_id
         and (
           ca.clipper_id = (select auth.uid())
           or public.is_campaign_workspace_member(ca.campaign_id)
         )
    )
  );

create or replace function public.tg_freeze_contract_terms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.brand_accepted_at is not null or old.clipper_accepted_at is not null)
     and new.terms_snapshot is distinct from old.terms_snapshot then
    raise exception 'Contract terms are frozen once accepted'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists freeze_contract_terms on public.contracts;
create trigger freeze_contract_terms
  before update on public.contracts
  for each row execute function public.tg_freeze_contract_terms();
