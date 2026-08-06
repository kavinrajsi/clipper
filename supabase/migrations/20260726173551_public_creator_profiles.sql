-- Phase 1 marketplace, slice 1: public creator profiles.
--
-- Adds a handle, an is_public flag, portfolio items, and the read-only views
-- the public profile page needs.
--
-- NOTE ON PUBLIC ACCESS: this grants the `anon` role select on clipper_profiles
-- and portfolio_items, but only WHERE is_public = true. is_public defaults to
-- false, so applying this migration exposes nothing — every existing profile
-- stays private until its owner explicitly publishes.

-- ---------------------------------------------------------------------------
-- 1. Profile fields
-- ---------------------------------------------------------------------------

alter table public.clipper_profiles
  add column if not exists handle text,
  add column if not exists headline text,
  add column if not exists location text,
  add column if not exists languages text[] not null default '{}',
  add column if not exists is_public boolean not null default false,
  add column if not exists published_at timestamptz;

-- Handles are matched lowercase in URLs.
create unique index if not exists clipper_profiles_handle_key
  on public.clipper_profiles (lower(handle))
  where handle is not null;

alter table public.clipper_profiles
  drop constraint if exists clipper_profiles_public_requires_handle;
alter table public.clipper_profiles
  add constraint clipper_profiles_public_requires_handle
  check (is_public = false or handle is not null);

-- 3–30 chars, lowercase alphanumeric plus hyphen/underscore, must start
-- alphanumeric.
alter table public.clipper_profiles
  drop constraint if exists clipper_profiles_handle_format;
alter table public.clipper_profiles
  add constraint clipper_profiles_handle_format
  check (handle is null or handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$');

-- ---------------------------------------------------------------------------
-- 2. Reserved handles
--
-- Keep in sync with top-level route segments so a handle can never shadow a
-- real route. /c/[handle] is namespaced, but these are still reserved to avoid
-- confusing or impersonating URLs.
-- ---------------------------------------------------------------------------

create table if not exists public.reserved_handles (
  handle text primary key
);

insert into public.reserved_handles (handle) values
  ('admin'), ('api'), ('app'), ('auth'), ('billing'), ('c'), ('campaigns'),
  ('clipper'), ('clippers'), ('clipper-profile'), ('connectors'), ('dashboard'),
  ('discover'), ('faq'), ('help'), ('login'), ('logout'), ('messages'),
  ('notifications'), ('payout-account'), ('privacy'), ('profile'), ('publishing'),
  ('saved'), ('settings'), ('signup'), ('studio'), ('support'), ('terms'),
  ('workspace'), ('www'), ('root'), ('null'), ('undefined'), ('me'), ('new')
on conflict (handle) do nothing;

alter table public.reserved_handles enable row level security;

drop policy if exists "Reserved handles are readable by anyone" on public.reserved_handles;
create policy "Reserved handles are readable by anyone"
  on public.reserved_handles for select
  to anon, authenticated
  using (true);

-- Enforce the denylist in the database, not just in the API.
create or replace function public.check_handle_not_reserved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.handle is not null
     and exists (select 1 from public.reserved_handles r where r.handle = lower(new.handle))
  then
    raise exception 'Handle "%" is reserved', new.handle
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists clipper_profiles_handle_guard on public.clipper_profiles;
create trigger clipper_profiles_handle_guard
  before insert or update of handle on public.clipper_profiles
  for each row execute function public.check_handle_not_reserved();

-- ---------------------------------------------------------------------------
-- 3. Public read on published profiles
-- ---------------------------------------------------------------------------

drop policy if exists "Public profiles are readable by anyone" on public.clipper_profiles;
create policy "Public profiles are readable by anyone"
  on public.clipper_profiles for select
  to anon, authenticated
  using (is_public = true or (select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 4. Portfolio
-- ---------------------------------------------------------------------------

create table if not exists public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('youtube_video','campaign_submission','manual')),
  youtube_video_id text,
  submission_id uuid references public.campaign_submissions(id) on delete set null,
  title text,
  thumbnail_url text,
  video_url text,
  view_count bigint,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_items_user_idx
  on public.portfolio_items (user_id, position);

alter table public.portfolio_items enable row level security;

drop policy if exists "Users manage their own portfolio" on public.portfolio_items;
create policy "Users manage their own portfolio"
  on public.portfolio_items for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Portfolio of public profiles is readable" on public.portfolio_items;
create policy "Portfolio of public profiles is readable"
  on public.portfolio_items for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.clipper_profiles cp
      where cp.user_id = portfolio_items.user_id
        and cp.is_public = true
    )
    or (select auth.uid()) = user_id
  );

-- ---------------------------------------------------------------------------
-- 5. Verification, without exposing OAuth tokens
--
-- youtube_connections holds access_token / refresh_token. A select policy on
-- that table would leak them, so expose only the safe columns through a
-- security-definer view, scoped to published profiles.
-- ---------------------------------------------------------------------------

drop view if exists public.creator_verification;
create view public.creator_verification
with (security_invoker = false) as
select
  yc.user_id,
  yc.verification_method,
  yc.verified_at,
  yc.bio_code_confirmed_at,
  yc.channel_title,
  yc.channel_thumbnail_url,
  yc.last_synced_at
from public.youtube_connections yc
where exists (
  select 1 from public.clipper_profiles cp
  where cp.user_id = yc.user_id
    and cp.is_public = true
);

revoke all on public.creator_verification from anon, authenticated;
grant select on public.creator_verification to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Creator stats
--
-- Scalar subqueries rather than joins: joining videos and payouts in one query
-- fans out and multiplies both aggregates.
--
-- A plain view for now. Promote to materialized once the directory sorts on it
-- and the row count justifies the refresh cost.
-- ---------------------------------------------------------------------------

drop view if exists public.creator_stats;
create view public.creator_stats
with (security_invoker = false) as
select
  cp.user_id,
  (select coalesce(sum(yv.view_count), 0)
     from public.youtube_videos yv
    where yv.user_id = cp.user_id)                as verified_views,
  (select count(*)
     from public.youtube_videos yv
    where yv.user_id = cp.user_id)                as videos_synced,
  (select count(*)
     from public.campaign_payouts pay
    where pay.clipper_id = cp.user_id
      and pay.status = 'released')                as completed_campaigns
from public.clipper_profiles cp
where cp.is_public = true;

revoke all on public.creator_stats from anon, authenticated;
grant select on public.creator_stats to anon, authenticated;
