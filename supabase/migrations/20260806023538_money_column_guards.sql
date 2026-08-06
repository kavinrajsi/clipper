-- ---------------------------------------------------------------------------
-- The payee can no longer write the numbers that decide their own payout
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG
--
-- /api/payments/submissions/[id]/approve computes a Razorpay transfer on the
-- SERVICE-ROLE client, which bypasses RLS. Every input it read was writable by
-- the clipper being paid, through ordinary PostgREST calls with their own
-- session:
--
--   youtube_videos.view_count            per-view payouts multiply by it
--   youtube_connections.payout_multiplier a direct multiplier on the final INR
--   clipper_payout_accounts.status        the "KYC finished" gate
--   clipper_payout_accounts.razorpay_account_id  where the money is sent
--   campaign_applications.bid_amount      the agreed rate
--
-- One PATCH set the payout. The only ceiling was the campaign's whole budget.
--
-- WHY THIS WAS MISSED FOR SO LONG
--
-- Every table added AFTER the baseline got a column-scope guard, because the
-- authors correctly worked out that RLS cannot restrict WHICH COLUMNS an update
-- touches (see tg_guard_source_asset_pipeline_columns, 20260801044647). The
-- insight was never applied backwards to the four baseline tables that feed the
-- payout arithmetic. This migration does that.
--
-- APP CHANGES THIS DEPENDS ON -- these ship together or the app breaks:
--   sync/route.js            youtube_videos upsert       -> service-role client
--   callback/route.js        youtube_connections upsert  -> service-role client
--   choose-method, verify-bio  verification tier         -> service-role client
--   payout-account, check-status  status/account id      -> service-role client
--
-- Each of those already proves the caller owns the row on the RLS-scoped client
-- first, then switches -- the same shape as every other admin-client route here.

-- ---------------------------------------------------------------------------
-- 1. youtube_videos -- no client writes at all
-- ---------------------------------------------------------------------------
--
-- Every column is YouTube's data, fetched by the sync route. The user owns
-- nothing here, so there is nothing to preserve: drop the write policies
-- outright rather than guard columns one by one. Same shape as ai_jobs and
-- campaign_payouts, which have no client insert/update policy by design.
-- SELECT is untouched -- creators still read their own videos.

drop policy if exists "Users can insert own youtube videos" on public.youtube_videos;
drop policy if exists "Users can update own youtube videos" on public.youtube_videos;

-- ---------------------------------------------------------------------------
-- 2. youtube_connections -- tokens stay writable, the verification tier does not
-- ---------------------------------------------------------------------------
--
-- Unlike youtube_videos this table has a legitimate client-write surface: the
-- sync route refreshes access_token and stamps last_synced_at as the user. So
-- the policy stays and a trigger scopes the columns.
--
-- payout_multiplier is the money column. The rest are the verification tier it
-- is derived from -- channel_id included, because choose-method now proves the
-- "linked" tier by asking Google whether the token owns that exact channel, and
-- a caller who could rewrite channel_id could aim that check at anything.

create or replace function public.tg_guard_youtube_connection_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller uuid;
begin
  -- Nested writes are the pipeline reaching through another trigger.
  if pg_trigger_depth() > 1 then return new; end if;

  caller := (select auth.uid());
  if caller is null then return new; end if;   -- service role / migrations

  if tg_op = 'INSERT' then
    -- A self-inserted row could arrive pre-verified at 1.0. The OAuth callback
    -- writes this row on the service-role client, so nothing legitimate needs
    -- to set these on insert.
    if new.payout_multiplier is not null
       or new.verification_method is not null
       or new.verified_at is not null
       or new.bio_code_confirmed_at is not null
       or new.channel_id is not null then
      raise exception 'Verification state is set by the connector, not the client'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.payout_multiplier    is distinct from old.payout_multiplier
     or new.verification_method  is distinct from old.verification_method
     or new.verified_at          is distinct from old.verified_at
     or new.bio_code_confirmed_at is distinct from old.bio_code_confirmed_at
     or new.verification_code    is distinct from old.verification_code
     or new.channel_id           is distinct from old.channel_id then
    raise exception 'Verification state is set by the connector, not the client'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end; $$;

drop trigger if exists guard_youtube_connection_columns on public.youtube_connections;
create trigger guard_youtube_connection_columns
  before insert or update on public.youtube_connections
  for each row execute function public.tg_guard_youtube_connection_columns();

revoke execute on function public.tg_guard_youtube_connection_columns()
  from public, anon, authenticated;

-- A multiplier is a discount, never a bonus. Belt and braces behind the
-- trigger: even a service-role bug cannot pay 1000x.
alter table public.youtube_connections
  drop constraint if exists youtube_connections_payout_multiplier_range;
alter table public.youtube_connections
  add constraint youtube_connections_payout_multiplier_range
  check (payout_multiplier is null or (payout_multiplier > 0 and payout_multiplier <= 1))
  not valid;
alter table public.youtube_connections
  validate constraint youtube_connections_payout_multiplier_range;

-- ---------------------------------------------------------------------------
-- 3. clipper_payout_accounts -- the user supplies KYC, Razorpay supplies the verdict
-- ---------------------------------------------------------------------------
--
-- PAN, bank details, name and address are the user's to write and correct.
-- status / razorpay_account_id / razorpay_product_id / activation_status are
-- Razorpay's answer, and approve/route.js gates the transfer on the first two:
-- a clipper who could set status='active' with an arbitrary razorpay_account_id
-- skipped KYC entirely and redirected the money.

create or replace function public.tg_guard_payout_account_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  caller := (select auth.uid());
  if caller is null then return new; end if;

  if tg_op = 'INSERT' then
    if new.status is not null
       or new.razorpay_account_id is not null
       or new.razorpay_product_id is not null
       or new.activation_status is not null then
      raise exception 'Account status comes from Razorpay, not the client'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.razorpay_account_id is distinct from old.razorpay_account_id
     or new.razorpay_product_id is distinct from old.razorpay_product_id
     or new.activation_status  is distinct from old.activation_status then
    raise exception 'Account status comes from Razorpay, not the client'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end; $$;

drop trigger if exists guard_payout_account_columns on public.clipper_payout_accounts;
create trigger guard_payout_account_columns
  before insert or update on public.clipper_payout_accounts
  for each row execute function public.tg_guard_payout_account_columns();

revoke execute on function public.tg_guard_payout_account_columns()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. campaign_applications -- the agreed terms freeze once the row exists
-- ---------------------------------------------------------------------------
--
-- "Workspace members can review applications" (20260726211302) is meant for
-- status and reviewed_at, but has no column scope. Any member -- including the
-- `member` role deliberately excluded from moving money -- could rewrite
-- bid_amount, which approve/route.js reads as agreedRate, or clipper_id, which
-- redirects the payee. The clipper's own policies could reach it too.

create or replace function public.tg_guard_application_terms()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  caller := (select auth.uid());
  if caller is null then return new; end if;

  if new.bid_amount  is distinct from old.bid_amount
     or new.clipper_id  is distinct from old.clipper_id
     or new.campaign_id is distinct from old.campaign_id then
    raise exception 'The agreed terms of an application cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end; $$;

drop trigger if exists guard_application_terms on public.campaign_applications;
create trigger guard_application_terms
  before update on public.campaign_applications
  for each row execute function public.tg_guard_application_terms();

revoke execute on function public.tg_guard_application_terms()
  from public, anon, authenticated;

-- A negative bid would invert the payout arithmetic.
alter table public.campaign_applications
  drop constraint if exists campaign_applications_bid_amount_positive;
alter table public.campaign_applications
  add constraint campaign_applications_bid_amount_positive
  check (bid_amount is null or bid_amount >= 0) not valid;
alter table public.campaign_applications
  validate constraint campaign_applications_bid_amount_positive;

-- ---------------------------------------------------------------------------
-- 5. youtube_videos.view_count sanity
-- ---------------------------------------------------------------------------
alter table public.youtube_videos
  drop constraint if exists youtube_videos_view_count_non_negative;
alter table public.youtube_videos
  add constraint youtube_videos_view_count_non_negative
  check (view_count is null or view_count >= 0) not valid;
alter table public.youtube_videos
  validate constraint youtube_videos_view_count_non_negative;
