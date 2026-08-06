-- ---------------------------------------------------------------------------
-- clipper_profiles: "brands see everything" keyed on a self-declared role
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG
--
--   "Brands can view all clipper profiles"  (20260725075602:539)
--     USING (exists (select 1 from profiles
--                     where id = auth.uid() and role = 'brand'))
--
-- The predicate reads a column the *subject* owns. profiles.role is chosen at
-- signup and defaults to 'clipper', so anyone could sign up, pick 'brand', and
-- read EVERY creator profile — including the ones with is_public = false, which
-- the sibling policy "Public profiles are readable by anyone" deliberately
-- withholds. That exposes bio, handle, location, pricing_model and rate_amount
-- for creators who explicitly kept their profile unlisted.
--
-- 20260805011434 locked the role after first choice, so this is no longer a
-- flag someone can flip back and forth — but the choice at signup is still free,
-- which is all the attack needs.
--
-- WHAT REPLACES IT
--
-- A brand does have a legitimate need to see an unlisted profile: someone who
-- applied to their campaign, or who they invited to one. That is a
-- relationship, not a role, and it is the thing actually worth checking.
--
-- Public profiles are untouched — "Public profiles are readable by anyone"
-- (20260726173551:99) already covers is_public = true for anon and
-- authenticated, so the creator directory and the public /c/[handle] pages keep
-- working exactly as before.

-- ---------------------------------------------------------------------------
-- 1. The relationship test
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER for the usual reason in this schema: the policy must not
-- read campaign_applications through its own policies, which read campaigns,
-- which is the 42P17 cycle 20260726185742 already had to unpick once. Answers
-- only a yes/no about the caller, exactly like has_applied_to_campaign and
-- is_invited_to_campaign.

create or replace function public.has_engagement_with_creator(creator uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.campaign_applications ca
      join public.campaigns c on c.id = ca.campaign_id
     where ca.clipper_id = creator
       and public.is_workspace_member(c.workspace_id)
  )
  or exists (
    select 1
      from public.campaign_invites ci
      join public.campaigns c on c.id = ci.campaign_id
     where ci.clipper_id = creator
       and public.is_workspace_member(c.workspace_id)
  );
$$;

-- This one IS called from inside an RLS policy, so unlike a trigger function it
-- is permission-checked against the caller and MUST keep its grant to
-- authenticated. Revoking from public/anon only.
revoke all on function public.has_engagement_with_creator(uuid) from public, anon;
grant execute on function public.has_engagement_with_creator(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Swap the policy
-- ---------------------------------------------------------------------------

drop policy if exists "Brands can view all clipper profiles" on public.clipper_profiles;

drop policy if exists "Engaged workspaces can view a creator profile" on public.clipper_profiles;
create policy "Engaged workspaces can view a creator profile"
  on public.clipper_profiles for select
  to authenticated
  using (public.has_engagement_with_creator(user_id));
