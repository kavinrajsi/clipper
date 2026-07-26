-- Proposals: structured applications.
--
-- `message` already exists and is the cover letter — no data migration needed.
-- This adds the comparable dimensions a brand needs to evaluate applicants
-- against each other: price, delivery time, and relevant work.
--
-- Attachments reference portfolio_items rather than uploaded files. Creators
-- already curate a portfolio, so this needs no storage bucket, no upload UI,
-- no size caps, no MIME allowlist and no abuse surface.

alter table public.campaign_applications
  add column if not exists bid_amount numeric
    check (bid_amount is null or bid_amount > 0),
  add column if not exists estimated_delivery_days int
    check (estimated_delivery_days is null or (estimated_delivery_days > 0 and estimated_delivery_days <= 365)),
  add column if not exists withdrawn_at timestamptz;

create table if not exists public.proposal_attachments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.campaign_applications(id) on delete cascade,
  portfolio_item_id uuid not null references public.portfolio_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (application_id, portfolio_item_id)
);

create index if not exists proposal_attachments_application_idx
  on public.proposal_attachments (application_id);

alter table public.proposal_attachments enable row level security;

-- An applicant may only attach portfolio items they own. Enforced here rather
-- than in the API so it holds regardless of how the row is written.
drop policy if exists "Applicants attach their own items" on public.proposal_attachments;
create policy "Applicants attach their own items"
  on public.proposal_attachments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.campaign_applications ca
      where ca.id = proposal_attachments.application_id
        and ca.clipper_id = (select auth.uid())
    )
    and exists (
      select 1 from public.portfolio_items pi
      where pi.id = proposal_attachments.portfolio_item_id
        and pi.user_id = (select auth.uid())
    )
  );

-- Visible to the applicant and to the campaign owner. Never to other
-- applicants — see the note on bids below.
--
-- Routed through has_applied_to_campaign()/campaign ownership carefully:
-- campaign_applications policies read campaigns, and campaigns policies read
-- campaign_applications, so anything here that joins both risks reintroducing
-- the 42P17 cycle fixed in 20260727091000. This policy touches
-- campaign_applications and campaigns in a single EXISTS, which is evaluated
-- from proposal_attachments and therefore does not close a loop back onto
-- itself.
drop policy if exists "Attachments visible to applicant and campaign owner"
  on public.proposal_attachments;
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

drop policy if exists "Applicants remove their own attachments" on public.proposal_attachments;
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

-- NOTE ON BIDS
-- bid_amount lives on campaign_applications, whose existing SELECT policies
-- already restrict rows to the applicant and the campaign owner. Competing
-- applicants cannot read each other's rows, so bids are not exposed. If a
-- broader read policy is ever added to that table, bids must be excluded from
-- it — visible competing bids are how collusion and race-to-the-bottom
-- pricing start.
