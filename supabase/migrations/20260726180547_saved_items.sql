-- Phase 1 marketplace, slice 3: saved creators and saved campaigns.
--
-- Composite primary keys make the toggle idempotent — an upsert cannot create
-- a duplicate, and there is no surrogate id to leak.
--
-- Follows are deliberately NOT included. A follow is a subscription, and
-- without notifications there is nothing to subscribe to. It lands with
-- notifications (docs/product/05-collaboration.md).

create table if not exists public.saved_creators (
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_id),
  check (user_id <> creator_id)
);

create index if not exists saved_creators_user_idx
  on public.saved_creators (user_id, created_at desc);

create table if not exists public.saved_campaigns (
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

create index if not exists saved_campaigns_user_idx
  on public.saved_campaigns (user_id, created_at desc);

alter table public.saved_creators  enable row level security;
alter table public.saved_campaigns enable row level security;

-- RLS pattern 1 (owner-only). A save list is private: exposing who a brand has
-- shortlisted would let competitors scrape their creator bench.
drop policy if exists "Users manage their own saved creators" on public.saved_creators;
create policy "Users manage their own saved creators"
  on public.saved_creators for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own saved campaigns" on public.saved_campaigns;
create policy "Users manage their own saved campaigns"
  on public.saved_campaigns for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
