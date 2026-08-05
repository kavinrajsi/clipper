-- Clipper or brand is chosen once, at signup, and then locked.
--
-- WHAT WAS WRONG
-- Nobody was ever asked. handle_new_user reads
-- `raw_user_meta_data ->> 'role'` and falls back to 'clipper', but
-- signInWithOAuth has no options.data — user metadata on an OAuth signup comes
-- from Google — so that key never arrives and every real user landed as a
-- clipper. The only way out was a toggle on /profile that rewrote the column
-- on every save, including a name-only edit, with nothing guarding it: the
-- "Users can update own profile" policy is row-scoped with no column
-- predicate.
--
-- WHY A FLAG RATHER THAN A NULLABLE role
-- Dropping NOT NULL to represent "not chosen yet" splits the app in half. The
-- readers fail open to clipper (src/lib/roles.js, app-sidebar.jsx) while the
-- policies that assert a role fail closed, so the user is shown the whole
-- clipper UI and has every write rejected by the database. role stays NOT
-- NULL; role_chosen_at answers the different question — did a human pick this.

alter table public.profiles
  add column if not exists role_chosen_at timestamptz;

-- Everyone who already exists keeps what they have and is never asked. Some of
-- them are on the wrong role because of the silent default above; that is now
-- a support request (see the admin route) rather than a self-service toggle.
--
-- Note this does nothing on a local `db reset` — migrations run before
-- seed.sql, against an empty table. The handle_new_user change below is what
-- gives the fixtures a sensible value.
update public.profiles set role_chosen_at = now() where role_chosen_at is null;

-- ---------------------------------------------------------------------------
-- 1. Signup
--
-- The `role` metadata key is only ever set by seed.sql and
-- scripts/dev-session.mjs — the two places where the role genuinely was picked
-- deliberately. Stamping role_chosen_at exactly when it is present keeps "this
-- role came from a choice" in one place instead of duplicating it into both
-- fixtures, and leaves a real Google signup correctly unchosen.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, avatar_url, role, role_chosen_at)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'role', 'clipper'),
    case when new.raw_user_meta_data ? 'role' then now() end
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The lock
--
-- RLS cannot restrict which COLUMNS an update touches, so a trigger does it —
-- the same reasoning and the same shape as tg_guard_member_self_update in
-- 20260726213652_workspace_invites.sql.
--
-- BRANCH ORDER IS LOAD-BEARING. The role_chosen_at check has to come before
-- the role-unchanged check: an update of {role: <same>, role_chosen_at: null}
-- changes no role and would sail straight through, unlocking the account for a
-- second write that does.
-- ---------------------------------------------------------------------------

create or replace function public.tg_guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller uuid;
begin
  caller := (select auth.uid());

  -- Service role, migrations, scripts. This is how /admin fixes a role that
  -- was picked wrongly, and it is the only way one can change.
  if caller is null then return new; end if;

  if old.role_chosen_at is not null
     and new.role_chosen_at is distinct from old.role_chosen_at then
    raise exception 'Your account type is already set and cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  -- Every /profile save still sends role. Unchanged is not a change.
  if new.role is not distinct from old.role then return new; end if;

  -- The one write the onboarding picker makes.
  if old.role_chosen_at is null then return new; end if;

  raise exception 'Your account type is already set and cannot be changed'
    using errcode = 'insufficient_privilege';
end; $$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role
  before update on public.profiles
  for each row execute function public.tg_guard_profile_role();

-- Trigger functions are never EXECUTE-checked, and leaving them callable at
-- /rest/v1/rpc/<name> is what 20260801051640 exists to prevent. Takes all
-- three grantees — Postgres grants to PUBLIC by default and Supabase grants to
-- anon and authenticated directly, so either half alone achieves nothing.
revoke execute on function public.tg_guard_profile_role() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
