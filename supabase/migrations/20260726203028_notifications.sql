-- Notifications, activity trail, and follows.
--
-- WHY TRIGGERS RATHER THAN A notify() HELPER
-- Most state changes here are written client-side with the RLS-scoped client
-- (applications from campaign-card, invites from campaign-invites-manager,
-- approvals from campaign-applications-list). A helper called from API routes
-- would silently miss all of them, and giving clients INSERT on notifications
-- would let anyone fabricate a notification in someone else's bell — a
-- phishing vector.
--
-- Triggers run SECURITY DEFINER on the same statement that changes the row, so
-- a notification cannot exist without the thing it describes, and no client
-- ever needs write access.
--
-- NOTE ON POLICY CYCLES: nothing here adds a policy that reads another table
-- whose policy reads back. See AGENTS.md before adding one.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  subject_type text,
  subject_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- Never notify someone about their own action.
  check (actor_id is null or actor_id <> user_id)
);

-- The unread count runs on every page load; keep it off the main index.
create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_all_idx
  on public.notifications (user_id, created_at desc);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  muted_kinds text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Append-only audit trail. No update or delete policy for anyone, including
-- admin — that immutability is what makes it usable in a payment dispute.
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  kind text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists activity_events_campaign_idx
  on public.activity_events (campaign_id, created_at desc);

-- Follows are a subscription. They only became meaningful once there was
-- something to deliver, which is why they land here and not with saves.
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);

alter table public.notifications             enable row level security;
alter table public.notification_preferences  enable row level security;
alter table public.activity_events           enable row level security;
alter table public.follows                   enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Policies
-- ---------------------------------------------------------------------------

-- Read and mark-read your own. Deliberately NO insert and NO delete for
-- clients: every row is written by a trigger.
drop policy if exists "Users read their own notifications" on public.notifications;
create policy "Users read their own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users mark their own notifications read" on public.notifications;
create policy "Users mark their own notifications read"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their notification preferences" on public.notification_preferences;
create policy "Users manage their notification preferences"
  on public.notification_preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Campaign participants read the trail. Written by triggers only.
drop policy if exists "Campaign participants read activity" on public.activity_events;
create policy "Campaign participants read activity"
  on public.activity_events for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = activity_events.campaign_id
        and c.brand_id = (select auth.uid())
    )
    or public.has_applied_to_campaign(activity_events.campaign_id)
  );

drop policy if exists "Users manage their own follows" on public.follows;
create policy "Users manage their own follows"
  on public.follows for all to authenticated
  using ((select auth.uid()) = follower_id)
  with check ((select auth.uid()) = follower_id);

-- Follower counts are public; follower lists are not. Exposing who follows
-- whom would let a competitor scrape a brand's bench.
drop policy if exists "Anyone can see who a user follows" on public.follows;

-- ---------------------------------------------------------------------------
-- 3. Emitter
-- ---------------------------------------------------------------------------

create or replace function public.emit_notification(
  p_user_id uuid, p_kind text, p_title text,
  p_body text default null, p_url text default null,
  p_actor_id uuid default null,
  p_subject_type text default null, p_subject_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_display text;
begin
  if p_user_id is null then return; end if;
  -- Self-actions are not news.
  if p_actor_id is not null and p_actor_id = p_user_id then return; end if;

  if exists (
    select 1 from public.notification_preferences np
    where np.user_id = p_user_id and p_kind = any(np.muted_kinds)
  ) then
    return;
  end if;

  select full_name into actor_display from public.profiles where id = p_actor_id;

  insert into public.notifications
    (user_id, kind, title, body, url, actor_id, actor_name, subject_type, subject_id)
  values
    (p_user_id, p_kind, p_title, p_body, p_url, p_actor_id, actor_display, p_subject_type, p_subject_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

-- Application created -> tell the brand.
create or replace function public.tg_notify_application_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, title, brand_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;

  perform public.emit_notification(
    c.brand_id, 'application_received',
    'New application',
    'Someone applied to ' || c.title,
    '/campaigns/' || c.id,
    new.clipper_id, 'application', new.id);

  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, new.clipper_id, 'application_received', jsonb_build_object('application_id', new.id));
  return new;
end; $$;

drop trigger if exists notify_application_created on public.campaign_applications;
create trigger notify_application_created
  after insert on public.campaign_applications
  for each row execute function public.tg_notify_application_created();

-- Application reviewed -> tell the clipper.
create or replace function public.tg_notify_application_reviewed()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('approved','rejected') then return new; end if;

  select id, title, brand_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;

  perform public.emit_notification(
    new.clipper_id,
    'application_' || new.status,
    case when new.status = 'approved' then 'Application approved' else 'Application not accepted' end,
    c.title,
    '/dashboard',
    c.brand_id, 'application', new.id);

  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, c.brand_id, 'application_' || new.status, jsonb_build_object('application_id', new.id));
  return new;
end; $$;

drop trigger if exists notify_application_reviewed on public.campaign_applications;
create trigger notify_application_reviewed
  after update on public.campaign_applications
  for each row execute function public.tg_notify_application_reviewed();

-- Invite sent -> tell the clipper.
create or replace function public.tg_notify_invite_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, title into c from public.campaigns where id = new.campaign_id;
  perform public.emit_notification(
    new.clipper_id, 'invite_received',
    'You have been invited to a campaign',
    coalesce(c.title, 'A campaign'),
    '/invitations',
    new.invited_by, 'invite', new.id);
  return new;
end; $$;

drop trigger if exists notify_invite_created on public.campaign_invites;
create trigger notify_invite_created
  after insert on public.campaign_invites
  for each row execute function public.tg_notify_invite_created();

-- Invite answered -> tell the brand.
create or replace function public.tg_notify_invite_answered()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('accepted','declined') then return new; end if;

  select id, title, brand_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;

  perform public.emit_notification(
    c.brand_id, 'invite_' || new.status,
    case when new.status = 'accepted' then 'Invite accepted' else 'Invite declined' end,
    coalesce(c.title, 'A campaign'),
    '/campaigns/' || c.id,
    new.clipper_id, 'invite', new.id);
  return new;
end; $$;

drop trigger if exists notify_invite_answered on public.campaign_invites;
create trigger notify_invite_answered
  after update on public.campaign_invites
  for each row execute function public.tg_notify_invite_answered();

-- Submission created -> tell the brand.
create or replace function public.tg_notify_submission_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select cm.id, cm.title, cm.brand_id into c
    from public.campaign_applications ca
    join public.campaigns cm on cm.id = ca.campaign_id
   where ca.id = new.application_id;
  if c.id is null then return new; end if;

  perform public.emit_notification(
    c.brand_id, 'submission_received',
    'New clip submitted',
    c.title,
    '/campaigns/' || c.id,
    new.clipper_id, 'submission', new.id);

  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, new.clipper_id, 'submission_received', jsonb_build_object('submission_id', new.id));
  return new;
end; $$;

drop trigger if exists notify_submission_created on public.campaign_submissions;
create trigger notify_submission_created
  after insert on public.campaign_submissions
  for each row execute function public.tg_notify_submission_created();

-- Payout held or released -> tell the clipper. campaign_payouts is written
-- only by the admin client after a real Razorpay call, so this fires exactly
-- when money actually moves.
create or replace function public.tg_notify_payout()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status not in ('held','released') then return new; end if;

  perform public.emit_notification(
    new.clipper_id, 'payout_' || new.status,
    case when new.status = 'held' then 'Payment held for your clip' else 'Payment released' end,
    null, '/dashboard', null, 'payout', new.id);
  return new;
end; $$;

drop trigger if exists notify_payout on public.campaign_payouts;
create trigger notify_payout
  after insert or update on public.campaign_payouts
  for each row execute function public.tg_notify_payout();
