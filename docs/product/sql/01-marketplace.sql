-- Phase 1 — Marketplace
-- Public creator profiles, portfolio, reviews, saves, follows, creator stats.
-- Spec: docs/product/01-marketplace.md
--
-- NOTE: this migration grants the `anon` role select access on published creator
-- profiles. That is the first publicly readable data in the system. Reviewed decision.

-- ---------------------------------------------------------------------------
-- 1. Public creator profiles
-- ---------------------------------------------------------------------------

alter table public.clipper_profiles
  add column if not exists handle text,
  add column if not exists headline text,
  add column if not exists location text,
  add column if not exists languages text[] not null default '{}',
  add column if not exists is_public boolean not null default false,
  add column if not exists published_at timestamptz;

-- Case-insensitive uniqueness; handles are matched lowercase in URLs.
create unique index if not exists clipper_profiles_handle_key
  on public.clipper_profiles (lower(handle))
  where handle is not null;

-- A profile cannot be published without a handle.
alter table public.clipper_profiles
  drop constraint if exists clipper_profiles_public_requires_handle;
alter table public.clipper_profiles
  add constraint clipper_profiles_public_requires_handle
  check (is_public = false or handle is not null);

-- Handle format: 3-30 chars, lowercase alphanumeric + hyphen/underscore.
alter table public.clipper_profiles
  drop constraint if exists clipper_profiles_handle_format;
alter table public.clipper_profiles
  add constraint clipper_profiles_handle_format
  check (handle is null or handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$');

-- Reserved handles. Keep in sync with top-level route segments.
create table if not exists public.reserved_handles (
  handle text primary key
);

insert into public.reserved_handles (handle) values
  ('admin'), ('api'), ('app'), ('auth'), ('billing'), ('campaigns'), ('c'),
  ('clippers'), ('clipper-profile'), ('connectors'), ('dashboard'), ('discover'),
  ('faq'), ('help'), ('login'), ('logout'), ('messages'), ('notifications'),
  ('payout-account'), ('privacy'), ('profile'), ('publishing'), ('saved'),
  ('settings'), ('signup'), ('studio'), ('support'), ('terms'), ('workspace'),
  ('www'), ('root'), ('null'), ('undefined')
on conflict (handle) do nothing;

alter table public.reserved_handles enable row level security;

create policy "Reserved handles are readable by anyone"
  on public.reserved_handles for select
  to anon, authenticated
  using (true);

-- Enforce the denylist at the database level, not just in the API.
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

-- Published profiles are world-readable; owners always see their own.
drop policy if exists "Public profiles are readable by anyone" on public.clipper_profiles;
create policy "Public profiles are readable by anyone"
  on public.clipper_profiles for select
  to anon, authenticated
  using (is_public = true or (select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Verification status without exposing OAuth tokens
--
-- youtube_connections holds access_token / refresh_token. A blanket select
-- policy on that table would leak them. Expose only the safe columns via a
-- security-definer view instead.
-- ---------------------------------------------------------------------------

create or replace view public.creator_verification
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
-- 3. Portfolio
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

-- Pattern 1: owner-only writes.
create policy "Users manage their own portfolio"
  on public.portfolio_items for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Readable when the owning profile is published.
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
-- 4. Reviews
--
-- Insert is gated on a RELEASED payout for the engagement being reviewed.
-- This is the anti-fraud property: money moved, or there is no review.
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.campaign_applications(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('brand_to_clipper','clipper_to_brand')),
  rating int not null check (rating between 1 and 5),
  communication_rating int check (communication_rating between 1 and 5),
  quality_rating int check (quality_rating between 1 and 5),
  timeliness_rating int check (timeliness_rating between 1 and 5),
  body text,
  author_display_name text,
  is_published boolean not null default false,
  published_at timestamptz,
  response_body text,
  response_at timestamptz,
  created_at timestamptz not null default now(),
  unique (application_id, direction),
  check (author_id <> subject_id)
);

create index if not exists reviews_subject_published_idx
  on public.reviews (subject_id, created_at desc)
  where is_published;

alter table public.reviews enable row level security;

-- Pattern 2: cross-user exists(), with the released-payout gate.
create policy "Reviews require a released payout"
  on public.reviews for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1
      from public.campaign_applications ca
      join public.campaigns c on c.id = ca.campaign_id
      join public.campaign_payouts pay on pay.application_id = ca.id
      where ca.id = reviews.application_id
        and pay.status = 'released'
        and (
          (reviews.direction = 'brand_to_clipper'
            and c.brand_id = (select auth.uid())
            and reviews.subject_id = ca.clipper_id)
          or
          (reviews.direction = 'clipper_to_brand'
            and ca.clipper_id = (select auth.uid())
            and reviews.subject_id = c.brand_id)
        )
    )
  );

create policy "Published reviews are readable by anyone"
  on public.reviews for select
  to anon, authenticated
  using (
    is_published
    or author_id = (select auth.uid())
    or subject_id = (select auth.uid())
  );

-- Authors may edit only before publication. Subjects may add one response.
create policy "Authors edit unpublished reviews"
  on public.reviews for update
  to authenticated
  using (author_id = (select auth.uid()) and is_published = false)
  with check (author_id = (select auth.uid()));

create policy "Subjects may respond to published reviews"
  on public.reviews for update
  to authenticated
  using (subject_id = (select auth.uid()) and is_published = true)
  with check (subject_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Saves and follows
-- ---------------------------------------------------------------------------

create table if not exists public.saved_creators (
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_id)
);

create table if not exists public.saved_campaigns (
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);

alter table public.saved_creators  enable row level security;
alter table public.saved_campaigns enable row level security;
alter table public.follows         enable row level security;

-- Pattern 1 throughout. Follower lists stay private; only counts are public,
-- and those are served from creator_stats rather than by reading this table.
create policy "Users manage their own saved creators"
  on public.saved_creators for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own saved campaigns"
  on public.saved_campaigns for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own follows"
  on public.follows for all
  to authenticated
  using ((select auth.uid()) = follower_id)
  with check ((select auth.uid()) = follower_id);

-- ---------------------------------------------------------------------------
-- 6. Creator stats
--
-- Materialized: the directory sorts on these and they must not recompute
-- per request. Refresh on a schedule and after review publication.
-- ---------------------------------------------------------------------------

-- Scalar subqueries, not joins. Joining reviews + videos + payouts + follows
-- in one query fans out and multiplies every aggregate.
drop materialized view if exists public.creator_stats;
create materialized view public.creator_stats as
select
  cp.user_id,
  (select count(*)
     from public.reviews r
    where r.subject_id = cp.user_id
      and r.direction = 'brand_to_clipper'
      and r.is_published)                          as review_count,
  (select round(avg(r.rating), 2)
     from public.reviews r
    where r.subject_id = cp.user_id
      and r.direction = 'brand_to_clipper'
      and r.is_published)                          as avg_rating,
  (select coalesce(sum(yv.view_count), 0)
     from public.youtube_videos yv
    where yv.user_id = cp.user_id)                 as verified_views,
  (select count(*)
     from public.campaign_payouts pay
    where pay.clipper_id = cp.user_id
      and pay.status = 'released')                 as completed_campaigns,
  (select count(*)
     from public.follows f
    where f.following_id = cp.user_id)             as follower_count
from public.clipper_profiles cp;

create unique index if not exists creator_stats_user_idx
  on public.creator_stats (user_id);

revoke all on public.creator_stats from anon, authenticated;
grant select on public.creator_stats to anon, authenticated;

-- Call after review publication, payout release, or on a schedule.
create or replace function public.refresh_creator_stats()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.creator_stats;
$$;
