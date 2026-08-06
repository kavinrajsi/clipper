-- Ratings & reviews. Phase 1, docs/product/01-marketplace.md §3.
--
-- The anti-fraud property: leaving a review requires a RELEASED payout on the
-- engagement being reviewed. That gate lives in the insert policy, not in the
-- route, so it holds no matter which client writes.
--
-- Double-blind: neither side sees the other's review until both have submitted,
-- so nobody can retaliate against a score they have already read.
--
-- Three deliberate deviations from the doc:
--
--  1. The doc gates the brand side on campaigns.brand_id. 20260727120000
--     moved brand authority to workspace membership and left brand_id
--     populated but unread by any policy. Gating on it here would quietly deny
--     every workspace member except the owner -- invisible until a team has a
--     second member. Membership is the gate instead.
--
--  2. The doc declares author_id ... on delete cascade AND says reviews should
--     "survive with a denormalised author display name". Those contradict.
--     Following the notifications precedent (actor_id + actor_name), author_id
--     is nullable / on delete set null and author_name is captured at insert,
--     so a brand closing their account cannot erase a creator's reputation.
--
--  3. The doc's 14-day publication window needs a scheduled job; this project
--     has no pg_cron. The window is a clause in the select policy instead --
--     declarative, and it cannot fail to run. The publish-both trigger still
--     flips is_published the moment the counterpart lands, so published_at
--     stays accurate on the common path.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.campaign_applications(id) on delete cascade,
  -- Nullable by design: see deviation 2 above.
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  subject_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('brand_to_clipper','clipper_to_brand')),
  rating int not null check (rating between 1 and 5),
  communication_rating int check (communication_rating between 1 and 5),
  quality_rating int check (quality_rating between 1 and 5),
  timeliness_rating int check (timeliness_rating between 1 and 5),
  body text,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  -- One review per side per engagement. No review-bombing by re-reviewing.
  unique (application_id, direction)
);

create index if not exists reviews_subject_idx on public.reviews (subject_id);
create index if not exists reviews_author_idx  on public.reviews (author_id);

-- ---------------------------------------------------------------------------
-- 2. Eligibility helper
--
-- SECURITY DEFINER so the insert policy never reads campaign_applications or
-- campaigns through their own policies -- the cycle that produced 42P17 once
-- already (see 20260726185742_fix_campaigns_policy_recursion.sql).
-- ---------------------------------------------------------------------------

create or replace function public.can_review(
  p_application_id uuid, p_direction text, p_subject_id uuid
) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
      from public.campaign_applications ca
      join public.campaigns c        on c.id = ca.campaign_id
      join public.campaign_payouts p on p.application_id = ca.id
     where ca.id = p_application_id
       and p.status = 'released'
       and (
         -- The brand side: anyone on the campaign's workspace may write it,
         -- first writer wins (the unique constraint enforces one per side).
         (p_direction = 'brand_to_clipper'
            and p_subject_id = ca.clipper_id
            and exists (
              select 1 from public.workspace_members wm
               where wm.workspace_id = c.workspace_id
                 and wm.user_id = (select auth.uid())
                 and wm.accepted_at is not null))
         or
         -- The clipper side reviews the person they actually dealt with.
         (p_direction = 'clipper_to_brand'
            and ca.clipper_id = (select auth.uid())
            and p_subject_id = c.brand_id)
       )
  );
$$;

revoke all on function public.can_review(uuid, text, uuid) from public;
grant execute on function public.can_review(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.reviews enable row level security;

-- Published reviews are public -- that is the point of a reputation system.
-- An author always sees their own, published or not, so the edit window works.
drop policy if exists "Published reviews are readable" on public.reviews;
create policy "Published reviews are readable"
  on public.reviews for select
  to anon, authenticated
  using (
    is_published
    or created_at < now() - interval '14 days'
    or author_id = (select auth.uid())
  );

-- Money moved, or there is no review.
drop policy if exists "Reviews require a released payout" on public.reviews;
create policy "Reviews require a released payout"
  on public.reviews for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_review(application_id, direction, subject_id)
  );

-- Editable for an hour, and only before publication. Mutable published reviews
-- are a coercion vector ("change your review or I won't hire you again").
-- `not is_published` in the WITH CHECK is also what stops an author publishing
-- their own review early and defeating the double-blind.
drop policy if exists "Authors may correct an unpublished review" on public.reviews;
create policy "Authors may correct an unpublished review"
  on public.reviews for update
  to authenticated
  using (
    author_id = (select auth.uid())
    and not is_published
    and created_at > now() - interval '1 hour'
  )
  with check (
    author_id = (select auth.uid())
    and not is_published
  );

-- No delete policy: reviews are not erasable by either party.

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

-- Capture the author's display name at write time so the review survives the
-- account. Set server-side rather than trusting whatever the client sends.
create or replace function public.tg_reviews_capture_author_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select full_name into new.author_name from public.profiles where id = new.author_id;
  return new;
end; $$;

drop trigger if exists reviews_capture_author_name on public.reviews;
create trigger reviews_capture_author_name
  before insert on public.reviews
  for each row execute function public.tg_reviews_capture_author_name();

-- Double-blind release. When the second side lands, publish both at once.
-- SECURITY DEFINER because publishing the counterpart means writing a row the
-- current user is not allowed to update.
create or replace function public.tg_reviews_publish_pair()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  counterpart uuid;
begin
  select id into counterpart
    from public.reviews
   where application_id = new.application_id
     and direction <> new.direction
   limit 1;

  if counterpart is null then return new; end if;

  update public.reviews
     set is_published = true, published_at = now()
   where application_id = new.application_id
     and not is_published;

  return new;
end; $$;

drop trigger if exists reviews_publish_pair on public.reviews;
create trigger reviews_publish_pair
  after insert on public.reviews
  for each row execute function public.tg_reviews_publish_pair();

-- Tell the subject once their review is live.
create or replace function public.tg_notify_review_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.is_published or old.is_published then return new; end if;

  perform public.emit_notification(
    new.subject_id, 'review_published', 'You have a new review',
    coalesce(left(new.body, 120), null), '/reviews', new.author_id,
    'review', new.id);
  return new;
end; $$;

drop trigger if exists notify_review_published on public.reviews;
create trigger notify_review_published
  after update on public.reviews
  for each row execute function public.tg_notify_review_published();

-- A released payout is the only thing that opens a review window, so it is
-- also the only sensible moment to ask for one.
create or replace function public.tg_notify_review_prompt()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  brand uuid;
begin
  if new.status <> 'released' then return new; end if;
  -- Nested rather than `tg_op = 'UPDATE' and old.status = ...`: OLD is not
  -- assigned on INSERT, so the reference must not be reachable at all there.
  if tg_op = 'UPDATE' then
    if old.status = 'released' then return new; end if;
  end if;

  select c.brand_id into brand
    from public.campaign_applications ca
    join public.campaigns c on c.id = ca.campaign_id
   where ca.id = new.application_id;

  perform public.emit_notification(
    new.clipper_id, 'review_prompt', 'Rate this brand',
    'Reviews stay hidden until you both submit.', '/reviews', null,
    'payout', new.id);

  perform public.emit_notification(
    brand, 'review_prompt', 'Rate this clipper',
    'Reviews stay hidden until you both submit.', '/reviews', null,
    'payout', new.id);

  return new;
end; $$;

drop trigger if exists notify_review_prompt on public.campaign_payouts;
create trigger notify_review_prompt
  after insert or update on public.campaign_payouts
  for each row execute function public.tg_notify_review_prompt();

-- ---------------------------------------------------------------------------
-- 5. Aggregates
--
-- Extends the existing creator_stats view (20260726200000) rather than adding a
-- parallel one -- the profile page already selects from it, so ratings arrive
-- without a second round trip. This is also what the doc's own creator_stats
-- looked like; it just predates the view actually shipping.
--
-- Not the materialized view the doc specifies: the 14-day clause makes the
-- query non-deterministic, which materialization forbids. security_invoker =
-- false is carried over so anonymous visitors can read the aggregate without
-- being able to read individual rows.
--
-- The review predicate deliberately omits the author's-own-row clause from the
-- select policy: an unpublished review must not move the average for the one
-- person who can see it.
-- ---------------------------------------------------------------------------

create or replace view public.creator_stats
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
      and pay.status = 'released')                as completed_campaigns,
  (select count(*)
     from public.reviews r
    where r.subject_id = cp.user_id
      and r.direction = 'brand_to_clipper'
      and (r.is_published or r.created_at < now() - interval '14 days'))
                                                  as review_count,
  -- Below three reviews, show the count without an average. Small-n averages
  -- read as precision that isn't there.
  (select case when count(*) >= 3 then round(avg(r.rating)::numeric, 2) end
     from public.reviews r
    where r.subject_id = cp.user_id
      and r.direction = 'brand_to_clipper'
      and (r.is_published or r.created_at < now() - interval '14 days'))
                                                  as avg_rating
from public.clipper_profiles cp
where cp.is_public = true;

revoke all on public.creator_stats from anon, authenticated;
grant select on public.creator_stats to anon, authenticated;
