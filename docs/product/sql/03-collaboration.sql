-- Phase 1 — Collaboration
-- Notifications, preferences, activity events.
-- Spec: docs/product/05-collaboration.md

-- ---------------------------------------------------------------------------
-- 1. Notifications
--
-- Pattern 3 (service-role only) for writes: there is deliberately NO client
-- insert policy. Notifications are written server-side via createAdminClient()
-- from the routes that cause the state change, exactly like campaign_payouts.
-- A client-writable notifications table is a phishing vector.
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_display_name text,
  subject_type text,
  subject_id uuid,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  check (actor_id is null or actor_id <> user_id)
);

-- The unread-count query runs on every page load. Partial index keeps it cheap.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists notifications_user_all_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Pattern 1: read and mark-read your own. No insert, no delete for clients.
create policy "Users read their own notifications"
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users mark their own notifications read"
  on public.notifications for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Notification preferences
-- ---------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app jsonb not null default '{}',
  email jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "Users manage their own notification preferences"
  on public.notification_preferences for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. Activity events
--
-- Append-only audit trail. No update or delete policy for ANYONE, including
-- admin — that immutability is what makes it usable during a payment dispute.
-- ---------------------------------------------------------------------------

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_display_name text,
  kind text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists activity_events_campaign_idx
  on public.activity_events (campaign_id, created_at desc);

alter table public.activity_events enable row level security;

-- Pattern 2: campaign owner, or a clipper engaged on that campaign.
create policy "Campaign participants read activity"
  on public.activity_events for select
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = activity_events.campaign_id
        and c.brand_id = (select auth.uid())
    )
    or exists (
      select 1 from public.campaign_applications ca
      where ca.campaign_id = activity_events.campaign_id
        and ca.clipper_id = (select auth.uid())
    )
  );

-- Deliberately no insert/update/delete policies: writes are service-role only.
