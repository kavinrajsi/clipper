-- Phase 1 — Hiring
-- Campaign visibility, invites, richer proposals.
-- Also FIXES the broken "Clippers can view campaigns they applied to" policy.
-- Spec: docs/product/02-hiring.md
--
-- Depends on: 01-marketplace.sql (portfolio_items, for proposal attachments)

-- ---------------------------------------------------------------------------
-- 1. Campaign visibility
--
-- Default 'public' means every existing campaign behaves exactly as it does
-- today. Backward compatible by construction.
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public','invite_only','private')),
  add column if not exists slug text,
  add column if not exists max_applicants int check (max_applicants is null or max_applicants > 0);

create unique index if not exists campaigns_slug_key
  on public.campaigns (lower(slug))
  where slug is not null;

-- ---------------------------------------------------------------------------
-- 2. Invites
-- ---------------------------------------------------------------------------

create table if not exists public.campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  clipper_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  message text,
  status text not null default 'sent'
    check (status in ('sent','viewed','accepted','declined','expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, clipper_id)
);

create index if not exists campaign_invites_clipper_idx
  on public.campaign_invites (clipper_id, status, created_at desc);

alter table public.campaign_invites enable row level security;

-- Pattern 2: brand owns the campaign, or the invite is addressed to you.
create policy "Invites are visible to sender and recipient"
  on public.campaign_invites for select
  to authenticated
  using (
    clipper_id = (select auth.uid())
    or exists (
      select 1 from public.campaigns c
      where c.id = campaign_invites.campaign_id
        and c.brand_id = (select auth.uid())
    )
  );

create policy "Campaign owners can send invites"
  on public.campaign_invites for insert
  to authenticated
  with check (
    invited_by = (select auth.uid())
    and exists (
      select 1 from public.campaigns c
      where c.id = campaign_invites.campaign_id
        and c.brand_id = (select auth.uid())
    )
  );

-- Recipient responds; sender rescinds.
create policy "Recipients respond to their invites"
  on public.campaign_invites for update
  to authenticated
  using (clipper_id = (select auth.uid()))
  with check (clipper_id = (select auth.uid()));

create policy "Campaign owners can rescind invites"
  on public.campaign_invites for delete
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_invites.campaign_id
        and c.brand_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Fix the broken campaigns visibility policy
--
-- The existing "Clippers can view campaigns they applied to" policy has a
-- self-referential predicate (a.campaign_id = a.id) and therefore never
-- matches any row. Replaced here with one correct policy that also honours
-- the new visibility column.
-- ---------------------------------------------------------------------------

drop policy if exists "Clippers can view campaigns they applied to" on public.campaigns;
drop policy if exists "Clippers can view funded active campaigns"   on public.campaigns;

create policy "Clippers can view available campaigns"
  on public.campaigns for select
  to authenticated
  using (
    -- Public, funded, active campaigns
    (status = 'active' and funding_status = 'paid' and visibility = 'public')
    -- Own campaigns (brand side)
    or brand_id = (select auth.uid())
    -- Campaigns you were invited to, regardless of visibility
    or exists (
      select 1 from public.campaign_invites ci
      where ci.campaign_id = campaigns.id
        and ci.clipper_id = (select auth.uid())
    )
    -- Campaigns you already applied to (the case the broken policy intended)
    or exists (
      select 1 from public.campaign_applications ca
      where ca.campaign_id = campaigns.id
        and ca.clipper_id = (select auth.uid())
    )
  );

-- Supporting indexes for the exists() lookups above.
create index if not exists campaign_applications_clipper_campaign_idx
  on public.campaign_applications (clipper_id, campaign_id);

create index if not exists campaign_invites_campaign_clipper_idx
  on public.campaign_invites (campaign_id, clipper_id);

-- ---------------------------------------------------------------------------
-- 4. Proposals
--
-- `message` already exists and is the cover letter. No data migration needed.
--
-- IMPORTANT: bid_amount must be honoured by the payout computation in
-- src/app/api/payments/submissions/[id]/approve/route.js, which currently
-- reads campaign.payout_rate unconditionally. Ship both together or bids
-- are silently ignored.
-- ---------------------------------------------------------------------------

alter table public.campaign_applications
  add column if not exists bid_amount numeric check (bid_amount is null or bid_amount > 0),
  add column if not exists estimated_delivery_days int
    check (estimated_delivery_days is null or estimated_delivery_days > 0),
  add column if not exists withdrawn_at timestamptz;

create table if not exists public.proposal_attachments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.campaign_applications(id) on delete cascade,
  portfolio_item_id uuid references public.portfolio_items(id) on delete set null,
  file_url text,
  title text,
  created_at timestamptz not null default now(),
  check (portfolio_item_id is not null or file_url is not null)
);

create index if not exists proposal_attachments_application_idx
  on public.proposal_attachments (application_id);

alter table public.proposal_attachments enable row level security;

-- Applicant attaches only their own portfolio items.
create policy "Applicants attach their own items"
  on public.proposal_attachments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.campaign_applications ca
      where ca.id = proposal_attachments.application_id
        and ca.clipper_id = (select auth.uid())
    )
    and (
      portfolio_item_id is null
      or exists (
        select 1 from public.portfolio_items pi
        where pi.id = proposal_attachments.portfolio_item_id
          and pi.user_id = (select auth.uid())
      )
    )
  );

-- Visible to the applicant and to the campaign owner. Never to other applicants.
create policy "Attachments visible to applicant and campaign owner"
  on public.proposal_attachments for select
  to authenticated
  using (
    exists (
      select 1
      from public.campaign_applications ca
      join public.campaigns c on c.id = ca.campaign_id
      where ca.id = proposal_attachments.application_id
        and (ca.clipper_id = (select auth.uid()) or c.brand_id = (select auth.uid()))
    )
  );

create policy "Applicants remove their own attachments"
  on public.proposal_attachments for delete
  to authenticated
  using (
    exists (
      select 1 from public.campaign_applications ca
      where ca.id = proposal_attachments.application_id
        and ca.clipper_id = (select auth.uid())
    )
  );
