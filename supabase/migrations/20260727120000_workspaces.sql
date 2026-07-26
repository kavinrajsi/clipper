-- Workspaces: a campaign belongs to an organisation, not a person.
--
-- campaigns.brand_id referenced auth.users(id), and every brand-side policy
-- compared it to auth.uid(). That blocked teams entirely — a marketing team
-- shared one login, an agency could not separate clients, and nobody could be
-- given "review submissions but do not release payments".
--
-- Nothing user-visible changes here. Each existing brand user gets exactly one
-- workspace containing only themselves, so every campaign stays reachable by
-- the same person.
--
-- brand_id is KEPT and still populated. No policy reads it any more, but
-- dropping a column is irreversible and the code change is broad; it goes in a
-- follow-up once the team UI is stable.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  owner_id uuid not null references auth.users(id),
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- owner   : everything, including deleting the workspace
  -- admin   : everything except deleting the workspace
  -- member  : campaigns and creative review — CANNOT move money
  -- billing : funding and payout release — the finance separation
  role text not null default 'member'
    check (role in ('owner','admin','member','billing')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id) where accepted_at is not null;

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Columns first.
--
-- Postgres validates a SQL function body at CREATE time, so campaigns.workspace_id
-- has to exist before is_campaign_workspace_member() can reference it. Adding
-- the columns here rather than with the backfill keeps that ordering obvious.
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists campaigns_workspace_idx on public.campaigns (workspace_id);

alter table public.brand_profiles
  add column if not exists workspace_id uuid references public.workspaces(id);

-- ---------------------------------------------------------------------------
-- 3. Membership helpers — SECURITY DEFINER, and not optional.
--
-- workspace_members needs a "members can see co-members" policy, which reads
-- workspace_members: self-referential, and Postgres raises 42P17 at QUERY time,
-- not at policy-creation time. workspaces and campaigns policies read it too.
-- This is the same failure already shipped once on campaigns/campaign_applications.
--
-- These bypass RLS on workspace_members (postgres-owned, no FORCE row security)
-- and answer only about the CALLER, so neither widens access.
-- A pending invite (accepted_at is null) grants nothing.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = (select auth.uid())
      and wm.accepted_at is not null
  );
$$;

create or replace function public.workspace_role(ws uuid)
returns text language sql security definer stable set search_path = public as $$
  select wm.role from public.workspace_members wm
   where wm.workspace_id = ws
     and wm.user_id = (select auth.uid())
     and wm.accepted_at is not null
   limit 1;
$$;

-- Membership on the campaign's workspace, for policies on child tables.
create or replace function public.is_campaign_workspace_member(c_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
      from public.campaigns c
      join public.workspace_members wm on wm.workspace_id = c.workspace_id
     where c.id = c_id
       and wm.user_id = (select auth.uid())
       and wm.accepted_at is not null
  );
$$;

revoke all on function public.is_workspace_member(uuid)          from public;
revoke all on function public.workspace_role(uuid)               from public;
revoke all on function public.is_campaign_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid)          to authenticated;
grant execute on function public.workspace_role(uuid)               to authenticated;
grant execute on function public.is_campaign_workspace_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill — one workspace per existing brand user
-- ---------------------------------------------------------------------------

insert into public.workspaces (name, owner_id)
select coalesce(bp.company_name, p.full_name, 'My workspace'), p.id
  from public.profiles p
  left join public.brand_profiles bp on bp.user_id = p.id
 where p.role = 'brand'
   and not exists (select 1 from public.workspaces w where w.owner_id = p.id);

insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
select w.id, w.owner_id, 'owner', now()
  from public.workspaces w
 where not exists (
   select 1 from public.workspace_members wm
    where wm.workspace_id = w.id and wm.user_id = w.owner_id
 );

update public.campaigns c
   set workspace_id = w.id
  from public.workspaces w
 where w.owner_id = c.brand_id
   and c.workspace_id is null;

update public.brand_profiles bp
   set workspace_id = w.id
  from public.workspaces w
 where w.owner_id = bp.user_id
   and bp.workspace_id is null;

-- ---------------------------------------------------------------------------
-- 5. A brand user always has a workspace.
--
-- Signup defaults role to 'clipper' and it switches on /profile, so this hangs
-- off the role change rather than off user creation.
-- ---------------------------------------------------------------------------

create or replace function public.tg_ensure_workspace_for_brand()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws_id uuid;
begin
  if new.role <> 'brand' then return new; end if;
  if exists (select 1 from public.workspaces w where w.owner_id = new.id) then
    return new;
  end if;

  insert into public.workspaces (name, owner_id)
  values (coalesce(new.full_name, 'My workspace'), new.id)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
  values (ws_id, new.id, 'owner', now());

  return new;
end; $$;

drop trigger if exists ensure_workspace_for_brand on public.profiles;
create trigger ensure_workspace_for_brand
  after insert or update of role on public.profiles
  for each row execute function public.tg_ensure_workspace_for_brand();

-- ---------------------------------------------------------------------------
-- 6. Policies on the new tables
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view their workspaces" on public.workspaces;
create policy "Members can view their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(workspaces.id));

drop policy if exists "Owners and admins can update the workspace" on public.workspaces;
create policy "Owners and admins can update the workspace"
  on public.workspaces for update to authenticated
  using (public.workspace_role(workspaces.id) in ('owner','admin'))
  with check (public.workspace_role(workspaces.id) in ('owner','admin'));

drop policy if exists "Members can view co-members" on public.workspace_members;
create policy "Members can view co-members"
  on public.workspace_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_workspace_member(workspace_members.workspace_id)
  );

drop policy if exists "Owners and admins manage members" on public.workspace_members;
create policy "Owners and admins manage members"
  on public.workspace_members for all to authenticated
  using (public.workspace_role(workspace_members.workspace_id) in ('owner','admin'))
  with check (public.workspace_role(workspace_members.workspace_id) in ('owner','admin'));

-- ---------------------------------------------------------------------------
-- 7. Repoint the 14 brand_id policies onto workspace membership.
--
-- RLS enforces MEMBERSHIP. Role gating for money (funding, payout release) is
-- enforced in the API routes, because the release path uses the service-role
-- client and bypasses RLS entirely — so RLS could not gate it regardless.
-- See src/lib/workspaces.js.
-- ---------------------------------------------------------------------------

-- campaigns
drop policy if exists "Brands can view own campaigns" on public.campaigns;
create policy "Workspace members can view their campaigns"
  on public.campaigns for select to authenticated
  using (public.is_workspace_member(campaigns.workspace_id));

drop policy if exists "Brands can create own campaigns" on public.campaigns;
create policy "Workspace members can create campaigns"
  on public.campaigns for insert to authenticated
  with check (
    public.workspace_role(campaigns.workspace_id) in ('owner','admin','member')
  );

drop policy if exists "Brands can update own campaigns" on public.campaigns;
create policy "Workspace members can update their campaigns"
  on public.campaigns for update to authenticated
  using (public.is_workspace_member(campaigns.workspace_id))
  with check (public.is_workspace_member(campaigns.workspace_id));

drop policy if exists "Brands can delete own campaigns" on public.campaigns;
create policy "Owners and admins can delete campaigns"
  on public.campaigns for delete to authenticated
  using (public.workspace_role(campaigns.workspace_id) in ('owner','admin'));

-- campaign_applications
drop policy if exists "Brands can view applications to own campaigns" on public.campaign_applications;
create policy "Workspace members can view applications"
  on public.campaign_applications for select to authenticated
  using (public.is_campaign_workspace_member(campaign_applications.campaign_id));

drop policy if exists "Brands can review applications to own campaigns" on public.campaign_applications;
create policy "Workspace members can review applications"
  on public.campaign_applications for update to authenticated
  using (public.is_campaign_workspace_member(campaign_applications.campaign_id))
  with check (public.is_campaign_workspace_member(campaign_applications.campaign_id));

-- campaign_submissions
drop policy if exists "Brands can view submissions to own campaigns" on public.campaign_submissions;
create policy "Workspace members can view submissions"
  on public.campaign_submissions for select to authenticated
  using (
    exists (
      select 1 from public.campaign_applications ca
      where ca.id = campaign_submissions.application_id
        and public.is_campaign_workspace_member(ca.campaign_id)
    )
  );

drop policy if exists "Brands can review submissions to own campaigns" on public.campaign_submissions;
create policy "Workspace members can review submissions"
  on public.campaign_submissions for update to authenticated
  using (
    exists (
      select 1 from public.campaign_applications ca
      where ca.id = campaign_submissions.application_id
        and public.is_campaign_workspace_member(ca.campaign_id)
    )
  );

-- campaign_invites
drop policy if exists "Invites are visible to sender and recipient" on public.campaign_invites;
create policy "Invites are visible to recipient and workspace"
  on public.campaign_invites for select to authenticated
  using (
    clipper_id = (select auth.uid())
    or public.is_campaign_workspace_member(campaign_invites.campaign_id)
  );

drop policy if exists "Campaign owners can send invites" on public.campaign_invites;
create policy "Workspace members can send invites"
  on public.campaign_invites for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and public.is_campaign_workspace_member(campaign_invites.campaign_id)
  );

drop policy if exists "Campaign owners can rescind invites" on public.campaign_invites;
create policy "Workspace members can rescind invites"
  on public.campaign_invites for delete to authenticated
  using (public.is_campaign_workspace_member(campaign_invites.campaign_id));

-- campaign_payouts
drop policy if exists "Brands can view payouts for own campaigns" on public.campaign_payouts;
create policy "Workspace members can view payouts"
  on public.campaign_payouts for select to authenticated
  using (
    exists (
      select 1 from public.campaign_applications ca
      where ca.id = campaign_payouts.application_id
        and public.is_campaign_workspace_member(ca.campaign_id)
    )
  );

-- activity_events
drop policy if exists "Campaign participants read activity" on public.activity_events;
create policy "Campaign participants read activity"
  on public.activity_events for select to authenticated
  using (
    public.is_campaign_workspace_member(activity_events.campaign_id)
    or public.has_applied_to_campaign(activity_events.campaign_id)
  );

-- proposal_attachments
drop policy if exists "Attachments visible to applicant and campaign owner" on public.proposal_attachments;
create policy "Attachments visible to applicant and workspace"
  on public.proposal_attachments for select to authenticated
  using (
    exists (
      select 1 from public.campaign_applications ca
      where ca.id = proposal_attachments.application_id
        and (
          ca.clipper_id = (select auth.uid())
          or public.is_campaign_workspace_member(ca.campaign_id)
        )
    )
  );

-- brand_profiles: readable by the workspace, still writable by its owner.
drop policy if exists "Workspace members can view the brand profile" on public.brand_profiles;
create policy "Workspace members can view the brand profile"
  on public.brand_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

-- ---------------------------------------------------------------------------
-- 8. Notification triggers are deliberately NOT changed here.
--
-- They resolve the brand recipient via campaigns.brand_id, which is still
-- populated, and after this migration every workspace has exactly one member —
-- the owner — so the recipient is identical either way.
--
-- Once a workspace can have several members, "notify the brand" becomes
-- "notify which members?", which is a product question (everyone? only
-- reviewers? per-member preferences?) and belongs with the team UI, not here.
-- This helper is what those triggers will use.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_owner(ws uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select owner_id from public.workspaces where id = ws;
$$;

revoke all on function public.workspace_owner(uuid) from public;
grant execute on function public.workspace_owner(uuid) to authenticated;
