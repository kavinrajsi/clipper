-- ---------------------------------------------------------------------------
-- workspace_members: close the INSERT half of the invitation invariant
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG
--
-- 20260726213652_workspace_invites.sql states the invariant plainly: "Both
-- still require an explicit accept, so nobody is silently added to an
-- organisation." tg_guard_member_self_update enforces it -- but only on UPDATE
-- (pg_trigger.tgtype = 19 = ROW|BEFORE|UPDATE, confirmed against production).
--
-- The "Owners and admins manage members" policy (20260726211302_workspaces.sql)
-- is `for all`, so an owner or admin could simply INSERT
--   (workspace_id, victim_id, 'member', accepted_at = now())
-- and skip the invitation entirely. The victim gains nothing they could not
-- already be given, so the impact is low -- but the stated invariant did not
-- hold, and an audit trail that says "accepted" when nobody accepted is worse
-- than no audit trail.
--
-- WHY A SECOND TRIGGER RATHER THAN WIDENING THE EXISTING ONE
--
-- Widening tg_guard_member_self_update to `before insert or update` looks like
-- the one-line fix and breaks the accept path. On INSERT, OLD is a NULL record,
-- so `new.workspace_id is distinct from old.workspace_id` evaluates TRUE and
-- the "not change its terms" branch fires on every insert. A separate trigger
-- leaves the existing UPDATE semantics untouched.

-- ---------------------------------------------------------------------------
-- 1. The guard
-- ---------------------------------------------------------------------------

create or replace function public.tg_guard_member_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller uuid;
begin
  -- The two triggers that bootstrap membership -- tg_ensure_workspace_for_brand
  -- (owner, pre-accepted) and tg_claim_workspace_invites (member, accepted_at
  -- null) -- insert here from inside their own trigger, so this runs nested.
  --
  -- An earlier version of this guard keyed that exemption on auth.uid() being
  -- null, the way tg_guard_profile_role does. That was wrong: a signup can
  -- happen while a JWT claim is set (supabase/tests/rls.sql does exactly this,
  -- and caught it), and then the brand's own workspace-owner row is refused and
  -- the whole signup fails. Depth is the honest test -- a direct PostgREST
  -- insert is depth 1, a trigger-driven one is 2 or more.
  if pg_trigger_depth() > 1 then return new; end if;

  caller := (select auth.uid());

  -- Service role and migrations. Same escape hatch as the other guards.
  if caller is null then return new; end if;

  -- Adding yourself is not "being added".
  if new.user_id = caller then return new; end if;

  -- Everyone else arrives as an invitation and accepts it themselves. The
  -- accept path is the UPDATE already covered by tg_guard_member_self_update.
  if new.accepted_at is not null then
    raise exception 'A new member has to accept their own invitation'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end; $$;

drop trigger if exists guard_member_insert on public.workspace_members;
create trigger guard_member_insert
  before insert on public.workspace_members
  for each row execute function public.tg_guard_member_insert();

-- Trigger functions are never EXECUTE-checked, and leaving one callable at
-- /rest/v1/rpc/<name> is what 20260801051640 exists to prevent. Takes all three
-- grantees -- Postgres grants to PUBLIC by default and Supabase grants to anon
-- and authenticated directly, so either half alone achieves nothing.
revoke execute on function public.tg_guard_member_insert() from public, anon, authenticated;
