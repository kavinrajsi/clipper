-- Replace the coalesce-sentinel index with NULLS NOT DISTINCT.
--
-- The sentinel version enforced the right rule, but PostgREST's `onConflict`
-- needs a nameable column list and cannot reference `coalesce(...)`, so
-- approve/route.js had no way to target it — the upsert would have failed at
-- runtime with the constraint in place.
--
-- Postgres 15+ (this project is on 17) lets a unique index treat NULLs as
-- equal. That gives the identical guarantee — one payout per application per
-- milestone, and exactly one when milestone_id is null — while staying a plain
-- (application_id, milestone_id) index that an upsert can name.

drop index if exists public.campaign_payouts_application_milestone_key;

create unique index if not exists campaign_payouts_application_milestone_key
  on public.campaign_payouts (application_id, milestone_id)
  nulls not distinct;
