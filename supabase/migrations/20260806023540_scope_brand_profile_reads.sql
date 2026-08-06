-- ---------------------------------------------------------------------------
-- brand_profiles: the workspace scoping added in 20260726211302 was inert
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG
--
-- 20260726211302 added "Workspace members can view the brand profile" under the
-- heading "brand_profiles: readable by the workspace" -- but only issued
-- `drop policy if exists` for its OWN name. The baseline policy
--
--     "Anyone can view brand profiles" ... FOR SELECT TO authenticated USING (true)
--
-- was never dropped, and policies OR together, so the restrictive one has been
-- dead weight ever since. Confirmed still live on production.
--
-- Every authenticated account -- any clipper, any competitor who signed up --
-- could read every brand's `guidelines`, `tone_notes`, colours, fonts,
-- `company_name`, `website`, `industry` and `workspace_id`.
--
-- The codebase already disagrees with itself about this: 20260801043611 locks
-- brand_voice to the workspace because "tone, audience, sample captions... is
-- positioning a brand may not want shared", while brand_profiles.tone_notes and
-- guidelines sat world-readable to every logged-in user.
--
-- WHY A VIEW RATHER THAN JUST DROPPING THE POLICY
--
-- Two cross-user reads are legitimate and would break: a clipper browsing
-- campaigns needs the brand's display identity (src/lib/campaigns.js
-- withBrandInfo) and so does the invitations page. Both select exactly
-- `user_id, company_name, logo_url` -- never the sensitive columns.
--
-- RLS is row-level and cannot express "everyone sees these three columns,
-- members see the rest", so the split is a view -- the same tool
-- 20260726173551 already uses for creator_verification.

-- ---------------------------------------------------------------------------
-- 1. The public-identity view
-- ---------------------------------------------------------------------------
--
-- security_invoker = false so it is not re-filtered by the caller's policies on
-- the base table -- that is the point. It exposes only the three columns the
-- app renders as a brand's public identity, matching creator_verification.

create or replace view public.brand_public
with (security_invoker = false) as
  select user_id, company_name, logo_url
    from public.brand_profiles;

grant select on public.brand_public to anon, authenticated;

comment on view public.brand_public is
  'Display identity for a brand — safe for any authenticated user to read. The
   base table brand_profiles is workspace-scoped and holds positioning
   (guidelines, tone_notes, colours) that must not leak.';

-- ---------------------------------------------------------------------------
-- 2. Retire the blanket policy
-- ---------------------------------------------------------------------------
--
-- "Workspace members can view the brand profile" (owner OR workspace member)
-- already exists and becomes the only SELECT path once this is gone.

drop policy if exists "Anyone can view brand profiles" on public.brand_profiles;

-- ---------------------------------------------------------------------------
-- 3. profiles.using(true) is deliberately LEFT ALONE
-- ---------------------------------------------------------------------------
--
-- The same audit flagged "Authenticated users can view basic profile info"
-- (USING (true)) on public.profiles. It stays, on purpose:
--
--   * The columns are id, full_name, avatar_url, role -- a user directory. There
--     is no email column; email lives only in auth.users.
--   * Cross-user name/avatar lookups are pervasive (messages, reviews,
--     applications, campaign lists, the public creator pages).
--   * Narrowing it to owner-only ALREADY SHIPPED ONCE and silently broke every
--     cross-user profile lookup in the app -- AGENTS.md records that regression.
--
-- Tightening it means enumerating each relationship that justifies a lookup,
-- which is a real piece of work and a real risk of a repeat. It is a much
-- smaller exposure than brand_profiles was, so it is recorded here as a known
-- and accepted gap rather than half-fixed under time pressure.
