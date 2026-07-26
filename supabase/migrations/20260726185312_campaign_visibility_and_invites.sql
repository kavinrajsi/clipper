-- Campaign visibility + invite-only campaigns.
--
-- SECURITY: adding a `visibility` column without also amending the two
-- policies below would be worse than not adding it — campaigns would look
-- private while remaining readable, and applicable-to, by any clipper who
-- learned the id. Both are rewritten here.
--
-- `default 'public'` means every existing campaign behaves exactly as it does
-- today. Backward compatible by construction.

alter table public.campaigns
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public','invite_only','private'));

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

create index if not exists campaign_invites_campaign_idx
  on public.campaign_invites (campaign_id, clipper_id);

alter table public.campaign_invites enable row level security;

-- RLS pattern 2: recipient, or the brand who owns the campaign.
drop policy if exists "Invites are visible to sender and recipient" on public.campaign_invites;
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

drop policy if exists "Campaign owners can send invites" on public.campaign_invites;
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

-- Recipient responds (accept/decline). Brand rescinds.
drop policy if exists "Recipients respond to their invites" on public.campaign_invites;
create policy "Recipients respond to their invites"
  on public.campaign_invites for update
  to authenticated
  using (clipper_id = (select auth.uid()))
  with check (clipper_id = (select auth.uid()));

drop policy if exists "Campaign owners can rescind invites" on public.campaign_invites;
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
-- Breaking the policy cycle.
--
-- The campaigns SELECT policy needs to ask "is the caller invited?", which
-- reads campaign_invites — whose own SELECT policy reads campaigns to check
-- brand ownership. Postgres detects that as infinite recursion (42P17) and
-- every campaigns query fails.
--
-- This helper is SECURITY DEFINER, so it bypasses RLS on campaign_invites and
-- the cycle never forms. It only ever answers a yes/no about the CALLER's own
-- invite, so it leaks nothing.
-- ---------------------------------------------------------------------------

create or replace function public.is_invited_to_campaign(c_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.campaign_invites ci
    where ci.campaign_id = c_id
      and ci.clipper_id = (select auth.uid())
  );
$$;

revoke all on function public.is_invited_to_campaign(uuid) from public;
grant execute on function public.is_invited_to_campaign(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- HOLE 1: read leak.
--
-- "Clippers can view funded active campaigns" had no visibility clause, so an
-- invite-only campaign would appear in every clipper's /campaigns list.
-- ---------------------------------------------------------------------------

drop policy if exists "Clippers can view funded active campaigns" on public.campaigns;
create policy "Clippers can view funded active campaigns"
  on public.campaigns for select
  to authenticated
  using (
    status = 'active'
    and funding_status = 'paid'
    and visibility = 'public'
  );

drop policy if exists "Invited clippers can view the campaign" on public.campaigns;
create policy "Invited clippers can view the campaign"
  on public.campaigns for select
  to authenticated
  using (public.is_invited_to_campaign(campaigns.id));

-- ---------------------------------------------------------------------------
-- HOLE 2: write leak.
--
-- The INSERT policy on campaign_applications checked only that the campaign
-- was active and paid — not that the caller was allowed to see it. A clipper
-- who learned an invite-only campaign's id could apply to it.
-- ---------------------------------------------------------------------------

drop policy if exists "Clippers can apply to funded active campaigns"
  on public.campaign_applications;
create policy "Clippers can apply to funded active campaigns"
  on public.campaign_applications for insert
  to authenticated
  with check (
    (select auth.uid()) = clipper_id
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'clipper'
    )
    and exists (
      select 1 from public.campaigns c
      where c.id = campaign_applications.campaign_id
        and c.status = 'active'
        and c.funding_status = 'paid'
        and (
          c.visibility = 'public'
          or public.is_invited_to_campaign(c.id)
        )
    )
  );
