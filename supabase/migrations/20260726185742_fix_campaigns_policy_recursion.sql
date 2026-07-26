-- Fixes 42P17 infinite recursion between campaigns and campaign_applications.
--
-- THE CYCLE
--   campaigns."Clippers can view campaigns they applied to"
--     reads campaign_applications
--       campaign_applications."Brands can view applications to own campaigns"
--         reads campaigns  -> recursion
--
-- Postgres raises this at runtime, not at policy-creation time, so it only
-- surfaces when a clipper actually selects from campaigns. That made it
-- invisible to a pg_policies check — which is how it shipped in
-- 20260726183000_fix_campaigns_applied_policy.sql. That migration corrected a
-- genuinely dead predicate (a.campaign_id = a.id, which never matched); making
-- it match is what completed the cycle. Clippers could not list campaigns at
-- all between that migration and this one.
--
-- Adding "Invited clippers can view the campaign" in
-- 20260727090000 would have introduced the same cycle via campaign_invites.
--
-- THE FIX
-- Both directions are legitimate, so break the cycle rather than drop a policy.
-- These helpers are SECURITY DEFINER, so the inner read runs as the function
-- owner (postgres) and skips RLS — the tables are postgres-owned and do not
-- FORCE row security. Each answers only a yes/no about the CALLER's own rows,
-- so neither widens what anyone can read.
--
-- Rule of thumb for anyone adding a policy here: a policy on table A must not
-- read table B if any policy on B reads A. Route it through a definer helper.

create or replace function public.has_applied_to_campaign(c_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.campaign_applications a
    where a.campaign_id = c_id
      and a.clipper_id = (select auth.uid())
  );
$$;

revoke all on function public.has_applied_to_campaign(uuid) from public;
grant execute on function public.has_applied_to_campaign(uuid) to authenticated;

create or replace function public.is_invited_to_campaign(c_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.campaign_invites ci
    where ci.campaign_id = c_id
      and ci.clipper_id = (select auth.uid())
  );
$$;

revoke all on function public.is_invited_to_campaign(uuid) from public;
grant execute on function public.is_invited_to_campaign(uuid) to authenticated;

drop policy if exists "Clippers can view campaigns they applied to" on public.campaigns;
create policy "Clippers can view campaigns they applied to"
  on public.campaigns for select to authenticated
  using (public.has_applied_to_campaign(campaigns.id));

drop policy if exists "Invited clippers can view the campaign" on public.campaigns;
create policy "Invited clippers can view the campaign"
  on public.campaigns for select to authenticated
  using (public.is_invited_to_campaign(campaigns.id));
