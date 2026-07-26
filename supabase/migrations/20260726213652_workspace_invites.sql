-- Workspace invites, claimed on signup.
--
-- Two pending states, deliberately distinct:
--   invited + has an account -> workspace_members row with accepted_at null
--   invited + no account yet -> workspace_invites row keyed on email
-- The second becomes the first when that person signs up. Both still require an
-- explicit accept, so nobody is silently added to an organisation.
--
-- profiles has no email column; email lives only in auth.users. That is why the
-- invite route needs the admin client, and why the claim runs as a trigger on
-- auth.users rather than in application code.

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member'
    check (role in ('admin','member','billing')),   -- never invite straight to owner
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists workspace_invites_unique
  on public.workspace_invites (workspace_id, lower(email))
  where claimed_at is null;

create index if not exists workspace_invites_email_idx
  on public.workspace_invites (lower(email)) where claimed_at is null;

alter table public.workspace_invites enable row level security;

-- Managed by the workspace's owners and admins.
--
-- There is deliberately NO "read invites addressed to my email" policy: being
-- able to ask "which workspaces invited this address" is an enumeration vector.
-- The claim happens in a SECURITY DEFINER trigger instead, so the invitee never
-- needs read access.
drop policy if exists "Owners and admins manage workspace invites" on public.workspace_invites;
create policy "Owners and admins manage workspace invites"
  on public.workspace_invites for all to authenticated
  using (public.workspace_role(workspace_invites.workspace_id) in ('owner','admin'))
  with check (public.workspace_role(workspace_invites.workspace_id) in ('owner','admin'));

-- ---------------------------------------------------------------------------
-- Claim on signup.
--
-- Same shape as handle_new_user(), which is already an auth.users trigger.
-- Runs AFTER INSERT so the profiles row from handle_new_user already exists.
-- ---------------------------------------------------------------------------

create or replace function public.tg_claim_workspace_invites()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if new.email is null then return new; end if;

  for inv in
    select * from public.workspace_invites
     where lower(email) = lower(new.email)
       and claimed_at is null
       and expires_at > now()
  loop
    -- accepted_at stays null: claiming an invite makes it visible to them, it
    -- does not join them to the workspace. They still accept explicitly.
    insert into public.workspace_members (workspace_id, user_id, role, invited_by, accepted_at)
    values (inv.workspace_id, new.id, inv.role, inv.invited_by, null)
    on conflict (workspace_id, user_id) do nothing;

    update public.workspace_invites set claimed_at = now() where id = inv.id;
  end loop;

  return new;
end; $$;

drop trigger if exists claim_workspace_invites on auth.users;
create trigger claim_workspace_invites
  after insert on auth.users
  for each row execute function public.tg_claim_workspace_invites();

-- ---------------------------------------------------------------------------
-- A pending invitee must be able to read the workspace's NAME.
--
-- "Members can view their workspaces" requires accepted membership, so without
-- this an invitee is asked to accept an invitation to [unknown]. This exposes
-- nothing beyond name and id, and only to someone who has a row addressed to
-- them.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member_or_invited(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_workspace_member_or_invited(uuid) from public;
grant execute on function public.is_workspace_member_or_invited(uuid) to authenticated;

drop policy if exists "Members can view their workspaces" on public.workspaces;
create policy "Members can view their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member_or_invited(workspaces.id));

-- ---------------------------------------------------------------------------
-- Accepting or declining your own invitation.
--
-- "Owners and admins manage members" is the only write policy, so a pending
-- invitee had no way to accept at all. Adding a blanket self-update policy
-- would be a privilege escalation: someone invited as 'member' could set their
-- own role to 'owner'.
--
-- RLS cannot restrict which COLUMNS an update touches, so the policy allows the
-- write and a trigger constrains it to accepted_at.
-- ---------------------------------------------------------------------------

drop policy if exists "Invitees respond to their own invitation" on public.workspace_members;
create policy "Invitees respond to their own invitation"
  on public.workspace_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Members can leave a workspace" on public.workspace_members;
create policy "Members can leave a workspace"
  on public.workspace_members for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.tg_guard_member_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller uuid;
begin
  caller := (select auth.uid());

  -- Privileged callers (service role, migrations, jobs) and workspace
  -- owners/admins may change anything.
  if caller is null then return new; end if;
  if public.workspace_role(new.workspace_id) in ('owner','admin') then return new; end if;

  -- Everyone else may only accept or decline their own invitation.
  if new.user_id <> caller then
    raise exception 'You can only respond to your own invitation'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role is distinct from old.role
     or new.workspace_id is distinct from old.workspace_id
     or new.invited_by is distinct from old.invited_by then
    raise exception 'You can only accept or decline an invitation, not change its terms'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end; $$;

drop trigger if exists guard_member_self_update on public.workspace_members;
create trigger guard_member_self_update
  before update on public.workspace_members
  for each row execute function public.tg_guard_member_self_update();

-- ---------------------------------------------------------------------------
-- A workspace must always keep at least one owner.
--
-- The API route is the only caller today, but this is the invariant that keeps
-- a workspace recoverable — enforcing it here means it holds however the row is
-- written, including from the SQL editor.
-- ---------------------------------------------------------------------------

create or replace function public.tg_protect_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  remaining int;
begin
  ws := coalesce(old.workspace_id, new.workspace_id);

  -- Only demotion or removal of an existing owner can strand a workspace.
  if old.role <> 'owner' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then return new; end if;

  select count(*) into remaining
    from public.workspace_members wm
   where wm.workspace_id = ws
     and wm.role = 'owner'
     and wm.accepted_at is not null
     and wm.user_id <> old.user_id;

  if remaining = 0 then
    raise exception 'A workspace must have at least one owner'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end; $$;

drop trigger if exists protect_last_owner on public.workspace_members;
create trigger protect_last_owner
  before update or delete on public.workspace_members
  for each row execute function public.tg_protect_last_owner();
