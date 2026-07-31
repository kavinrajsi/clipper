-- RLS regression suite.
--
-- WHY THIS EXISTS
-- Two bugs reached production that a schema inspection could not catch:
--
--   1. 42P17 infinite recursion between campaigns and campaign_applications.
--      Postgres raises it only when a query actually runs, so reading
--      pg_policies and confirming the predicate "looks right" passed while
--      clippers could not list campaigns at all.
--   2. A visibility column added without amending the matching policies, which
--      would have left invite-only campaigns readable and applicable-to by
--      anyone who knew the id.
--
-- Both are caught below by impersonating real users and running the queries
-- the app actually runs.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL editor -> paste and run. Or:
--     psql "$DATABASE_URL" -f supabase/tests/rls.sql
--   Everything happens inside a transaction that ROLLS BACK, so no row and no
--   policy change survives. Safe against production.
--
-- READING THE OUTPUT
--   Every row should read PASS, or NOTE where the suite is explaining one of
--   its own fixtures. Any FAIL is a real policy defect. A SKIP means the
--   database had no brand/clipper fixture and the suite asserted nothing —
--   scripts/rls-test.sh treats that as a failure too. Locally, supabase/seed.sql
--   supplies the fixture.
--
-- ADDING CASES
--   A policy on table A must not read table B if any policy on B reads A.
--   Route it through a SECURITY DEFINER helper instead — see
--   20260726185742_fix_campaigns_policy_recursion.sql.

begin;

create temp table rls_results(
  ord int generated always as identity,
  area text,
  check_name text,
  outcome text
) on commit drop;

do $$
declare
  brand_id  uuid;
  clip_id   uuid;
  ws_id     uuid;
  c_public  uuid;
  c_invite  uuid;
  n         int;
  ok        boolean;
  msg       text;
  app_id    uuid;
  pay_id    uuid;
  subj_id   uuid;
  had_policy boolean;

  procedure_note text;
begin
  -- Real users of each role. The suite is a no-op if the project has neither.
  select id into brand_id from public.profiles where role = 'brand'   limit 1;
  select id into clip_id  from public.profiles where role = 'clipper' limit 1;

  if brand_id is null or clip_id is null then
    insert into rls_results(area, check_name, outcome)
    values ('setup', 'a brand and a clipper profile exist', 'SKIP - need one of each');
    return;
  end if;

  -- The brand's workspace. Campaigns belong to a workspace now, so the fixtures
  -- must be created inside one or the membership policies see nothing.
  select w.id into ws_id from public.workspaces w where w.owner_id = brand_id limit 1;

  if ws_id is null then
    insert into rls_results(area, check_name, outcome)
    values ('setup', 'brand has a workspace', 'SKIP - no workspace for the brand user');
    return;
  end if;

  insert into public.campaigns
    (brand_id,workspace_id,title,platform,payout_structure,payout_rate,budget,status,funding_status,visibility)
  values (brand_id,ws_id,'RLS suite public','youtube','flat_fee',100,1000,'active','paid','public')
  returning id into c_public;

  insert into public.campaigns
    (brand_id,workspace_id,title,platform,payout_structure,payout_rate,budget,status,funding_status,visibility)
  values (brand_id,ws_id,'RLS suite invite','youtube','flat_fee',100,1000,'active','paid','invite_only')
  returning id into c_invite;

  ---------------------------------------------------------------------------
  -- 0. Workspaces. A campaign belongs to a workspace, and membership is what
  --    grants access. Pending members (accepted_at null) get nothing.
  ---------------------------------------------------------------------------
  select count(*) into n from public.campaigns where workspace_id is null;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'every campaign has a workspace',
          case when n = 0 then 'PASS' else 'FAIL ' || n || ' orphaned' end);

  select count(*) into n
    from public.campaigns c
    join public.workspaces w on w.id = c.workspace_id
   where w.owner_id <> c.brand_id;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'workspace owner matches original brand_id',
          case when n = 0 then 'PASS' else 'FAIL ' || n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.workspaces;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'non-member sees no workspace',
          case when n = 0 then 'PASS' else 'FAIL saw '||n end);

  ---------------------------------------------------------------------------
  -- 0b. Workspace membership boundaries.
  --
  -- The escalation case is the important one: workspace_members' self-update
  -- policy has to let an invitee set accepted_at without letting them set their
  -- own role. RLS cannot restrict columns, so a trigger does it — and a trigger
  -- is exactly the kind of thing that silently stops working.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.workspace_invites;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'non-admin CANNOT read workspace invites',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  -- Give the clipper a pending membership, then try to escalate through it.
  insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
  values (ws_id, clip_id, 'member', null)
  on conflict (workspace_id, user_id) do nothing;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.workspace_members set role = 'owner'
     where workspace_id = ws_id and user_id = clip_id;
    msg := 'FAIL escalated to owner';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'invitee CANNOT self-promote to owner', msg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  -- Probe the invite-only campaign, not every campaign in the workspace.
  -- c_public is active, paid and public, so "Clippers can view funded active
  -- campaigns" shows it to every authenticated user — which the visibility
  -- section below asserts on purpose. Counting all campaigns here therefore
  -- always saw at least 1 and could never pass, and it was measuring that
  -- policy rather than membership. c_invite is the campaign only membership
  -- could reveal to this user: they are not invited and have not applied.
  select count(*) into n from public.campaigns where id = c_invite;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'pending member sees no invite-only campaign',
          case when n = 0 then 'PASS' else 'FAIL saw '||n end);

  -- The last owner must survive both demotion and removal.
  --
  -- Clear the JWT claim first: set_config(..., true) is TRANSACTION-local, so a
  -- claim set for an earlier check is still in effect here even after
  -- `reset role`. Leaving it set makes the self-update guard fire instead of
  -- the last-owner guard, and the check reports a misleading 42501.
  perform set_config('request.jwt.claims', '', true);

  begin
    update public.workspace_members set role = 'member'
     where workspace_id = ws_id and user_id = brand_id;
    msg := 'FAIL demotion allowed';
  exception when check_violation then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'sole owner CANNOT be demoted', msg);

  delete from public.workspace_members where workspace_id = ws_id and user_id = clip_id;

  ---------------------------------------------------------------------------
  -- 1. Recursion guard. Any cycle surfaces here as 42P17.
  --    workspace_members' own policy reads workspace_members, so this is
  --    exactly where a missing SECURITY DEFINER helper shows up.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    perform count(*) from public.campaigns;
    perform count(*) from public.campaign_applications;
    perform count(*) from public.campaign_invites;
    perform count(*) from public.clipper_profiles;
    perform count(*) from public.saved_campaigns;
    perform count(*) from public.workspaces;
    perform count(*) from public.workspace_members;
    msg := 'PASS';
  exception when others then
    msg := 'FAIL ' || sqlstate || ' ' || left(sqlerrm, 70);
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('recursion', 'clipper can query every core table', msg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    perform count(*) from public.campaigns;
    perform count(*) from public.campaign_applications;
    perform count(*) from public.campaign_invites;
    perform count(*) from public.workspaces;
    perform count(*) from public.workspace_members;
    perform count(*) from public.campaign_payouts;
    perform count(*) from public.activity_events;
    msg := 'PASS';
  exception when others then
    msg := 'FAIL ' || sqlstate || ' ' || left(sqlerrm, 70);
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('recursion', 'brand can query every core table', msg);

  ---------------------------------------------------------------------------
  -- 2. Campaign visibility, uninvited clipper.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.campaigns where id = c_public;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('visibility', 'uninvited sees public campaign',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.campaigns where id = c_invite;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('visibility', 'uninvited CANNOT see invite-only campaign',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.campaign_applications (campaign_id, clipper_id)
    values (c_invite, clip_id);
    msg := 'FAIL insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('visibility', 'uninvited CANNOT apply to invite-only campaign', msg);

  ---------------------------------------------------------------------------
  -- 3. Campaign visibility, invited clipper.
  ---------------------------------------------------------------------------
  insert into public.campaign_invites (campaign_id, clipper_id, invited_by)
  values (c_invite, clip_id, brand_id);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.campaigns where id = c_invite;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('visibility', 'invited CAN see invite-only campaign',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.campaign_applications (campaign_id, clipper_id)
    values (c_invite, clip_id);
    msg := 'PASS';
  exception when insufficient_privilege then msg := 'FAIL blocked';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('visibility', 'invited CAN apply to invite-only campaign', msg);

  ---------------------------------------------------------------------------
  -- 4. Public creator profiles: readable only when published.
  ---------------------------------------------------------------------------
  update public.clipper_profiles
     set handle = 'rls-suite-probe', is_public = true
   where user_id = clip_id;

  set local role anon;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.clipper_profiles where user_id = clip_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('public profiles', 'anon sees a PUBLISHED profile',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  update public.clipper_profiles set is_public = false where user_id = clip_id;

  set local role anon;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.clipper_profiles where user_id = clip_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('public profiles', 'anon CANNOT see an unpublished profile',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  ---------------------------------------------------------------------------
  -- 5. OAuth tokens must never be reachable by a client role.
  --    creator_verification exists precisely so youtube_connections stays shut.
  ---------------------------------------------------------------------------
  select not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='youtube_connections'
       and roles::text like '%anon%'
  ) into ok;

  insert into rls_results(area, check_name, outcome)
  values ('tokens', 'youtube_connections has no anon read policy',
          case when ok then 'PASS' else 'FAIL anon policy present' end);

  set local role anon;
  perform set_config('request.jwt.claims', null, true);
  begin
    select count(*) into n from public.creator_verification;
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate; end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('tokens', 'creator_verification readable without exposing tokens', msg);

  ---------------------------------------------------------------------------
  -- 6. Saved items are private to their owner.
  ---------------------------------------------------------------------------
  insert into public.saved_campaigns (user_id, campaign_id) values (clip_id, c_public);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.saved_campaigns;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('saves', 'another user CANNOT read your saved items',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  ---------------------------------------------------------------------------
  -- 6b. Notifications. Written only by triggers; a client must never be able
  --     to forge one into someone else's bell, nor read another user's.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.notifications (user_id, kind, title)
    values (brand_id, 'phish', 'Click here');
    msg := 'FAIL client insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('notifications', 'client CANNOT forge a notification', msg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.notifications where user_id = brand_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('notifications', 'client CANNOT read another user''s notifications',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  -- The application inserted above should have notified the brand, via trigger.
  select count(*) into n from public.notifications
   where user_id = brand_id and kind = 'application_received';
  insert into rls_results(area, check_name, outcome)
  values ('notifications', 'application fires a notification',
          case when n >= 1 then 'PASS' else 'FAIL none' end);

  ---------------------------------------------------------------------------
  -- 7. Bids are visible only to the campaign owner.
  ---------------------------------------------------------------------------
  update public.campaign_applications set bid_amount = 4242
   where campaign_id = c_invite and clipper_id = clip_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.campaign_applications
   where campaign_id = c_invite and bid_amount = 4242;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('bids', 'campaign owner CAN read a bid',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  ---------------------------------------------------------------------------
  -- 8. Reviews. The anti-fraud property is that a review requires a RELEASED
  --    payout on the engagement being reviewed, enforced in the insert policy
  --    rather than in the route. These cases are the only way to know that
  --    holds: Razorpay Route is disabled on this account, so no payout reaches
  --    'released' through the app and the gate cannot be exercised by clicking.
  ---------------------------------------------------------------------------
  select id into app_id from public.campaign_applications
   where campaign_id = c_invite and clipper_id = clip_id limit 1;

  insert into public.campaign_payouts (application_id, clipper_id, amount, status)
  values (app_id, clip_id, 100, 'held')
  returning id into pay_id;

  -- Held, not released: no review yet.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (application_id, author_id, subject_id, direction, rating)
    values (app_id, brand_id, clip_id, 'brand_to_clipper', 5);
    msg := 'FAIL review allowed on a held payout';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'held payout CANNOT be reviewed', msg);

  perform set_config('request.jwt.claims', '', true);
  update public.campaign_payouts set status = 'released', released_at = now()
   where id = pay_id;

  -- Released: the brand side may now write exactly one review.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (application_id, author_id, subject_id, direction, rating, body)
    values (app_id, brand_id, clip_id, 'brand_to_clipper', 5, 'RLS suite');
    msg := 'PASS';
  exception when insufficient_privilege then msg := 'FAIL blocked after release';
           when others then msg := 'FAIL ' || sqlstate || ' ' || left(sqlerrm, 60);
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'released payout CAN be reviewed', msg);

  -- One per side. A second attempt is the unique constraint, not a policy.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (application_id, author_id, subject_id, direction, rating)
    values (app_id, brand_id, clip_id, 'brand_to_clipper', 1);
    msg := 'FAIL second review allowed';
  exception when unique_violation then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'CANNOT review the same engagement twice', msg);

  -- The clipper was not party to the brand side and cannot author it.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (application_id, author_id, subject_id, direction, rating)
    values (app_id, clip_id, clip_id, 'brand_to_clipper', 5);
    msg := 'FAIL self-review allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'clipper CANNOT forge the brand-side review', msg);

  -- Double-blind: one side submitted, so nothing is published or public yet.
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.reviews
   where application_id = app_id and is_published;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'a lone review stays unpublished',
          case when n = 0 then 'PASS' else 'FAIL published '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.reviews where application_id = app_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'subject CANNOT read an unpublished review about them',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  -- The clipper submits theirs; the trigger publishes both.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.reviews (application_id, author_id, subject_id, direction, rating)
    values (app_id, clip_id, brand_id, 'clipper_to_brand', 4);
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate || ' ' || left(sqlerrm, 60);
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'clipper CAN review the brand', msg);

  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.reviews
   where application_id = app_id and is_published;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'both publish once the pair is complete',
          case when n = 2 then 'PASS' else 'FAIL published '||n end);

  -- author_name is captured server-side so the review survives the account.
  -- Asserts the trigger COPIED the name, not that it is non-null: full_name is
  -- nullable on profiles, and a null there must copy through as a null here
  -- rather than being treated as a trigger failure.
  select count(*) into n
    from public.reviews rev
    join public.profiles pr on pr.id = rev.author_id
   where rev.application_id = app_id
     and rev.author_name is not distinct from pr.full_name;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'author_name is denormalised at write time',
          case when n = 2 then 'PASS' else 'FAIL '||n||' of 2' end);

  -- Published reviews are immutable, including by their author.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  update public.reviews set body = 'edited after publication'
   where application_id = app_id and direction = 'brand_to_clipper';
  get diagnostics n = row_count;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('reviews', 'a published review CANNOT be edited',
          case when n = 0 then 'PASS' else 'FAIL updated '||n end);

  -- ---------------------------------------------------------------------
  -- APPROVALS
  --
  -- The whole point of a multi-approval policy is that ONE person cannot
  -- satisfy it. That guarantee lives in a unique constraint and two policies,
  -- and nothing else checks it — the route only counts rows.
  --
  -- subject_id has no FK, so a synthetic uuid is a faithful subject here: the
  -- policies key off workspace_id, never off the subject row.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  subj_id := gen_random_uuid();

  -- A second member, so a 2-approval policy is satisfiable at all.
  insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
  values (ws_id, clip_id, 'member', now())
  on conflict (workspace_id, user_id) do update set accepted_at = now();

  select exists(select 1 from public.approval_policies where workspace_id = ws_id)
    into had_policy;
  insert into public.approval_policies (workspace_id, submission_approvals_required)
  values (ws_id, 2)
  on conflict (workspace_id) do update set submission_approvals_required = 2;

  -- The brand approves as themselves.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.approvals (workspace_id, subject_type, subject_id, approver_id, decision)
    values (ws_id, 'submission', subj_id, brand_id, 'approved');
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate || ' ' || left(sqlerrm, 60);
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'a workspace member CAN record their own approval', msg);

  -- Approving twice is the obvious way to fake a second signature.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.approvals (workspace_id, subject_type, subject_id, approver_id, decision)
    values (ws_id, 'submission', subj_id, brand_id, 'approved');
    msg := 'FAIL second approval by the same person was accepted';
  exception when unique_violation then msg := 'PASS';
       when others then msg := 'FAIL ' || sqlstate || ' ' || left(sqlerrm, 60);
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'the same person CANNOT approve twice', msg);

  -- Signing someone else's name is the less obvious way.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.approvals (workspace_id, subject_type, subject_id, approver_id, decision)
    values (ws_id, 'submission', subj_id, clip_id, 'approved');
    msg := 'FAIL approved on another user''s behalf';
  exception when others then msg := 'PASS';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'a member CANNOT approve as someone else', msg);

  -- One of two: the gate must still be shut.
  perform set_config('request.jwt.claims', '', true);
  ok := public.has_required_approvals(ws_id, 'submission', subj_id, 5000);
  insert into rls_results(area, check_name, outcome)
  values ('approvals', '1 of 2 approvals does NOT clear the gate',
          case when ok is not true then 'PASS' else 'FAIL gate opened early' end);

  -- The second member signs; now it opens.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  insert into public.approvals (workspace_id, subject_type, subject_id, approver_id, decision)
  values (ws_id, 'submission', subj_id, clip_id, 'approved');
  reset role;

  perform set_config('request.jwt.claims', '', true);
  ok := public.has_required_approvals(ws_id, 'submission', subj_id, 5000);
  insert into rls_results(area, check_name, outcome)
  values ('approvals', '2 of 2 approvals clears the gate',
          case when ok then 'PASS' else 'FAIL gate stayed shut' end);

  -- Under the threshold, one signature is enough — checked on a FRESH subject
  -- so it cannot pass on the strength of the two approvals above.
  perform set_config('request.jwt.claims', '', true);
  subj_id := gen_random_uuid();
  update public.approval_policies set approval_threshold_amount = 10000
   where workspace_id = ws_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  insert into public.approvals (workspace_id, subject_type, subject_id, approver_id, decision)
  values (ws_id, 'submission', subj_id, brand_id, 'approved');
  reset role;

  perform set_config('request.jwt.claims', '', true);
  ok := public.has_required_approvals(ws_id, 'submission', subj_id, 500);
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'a small payout needs only one approval',
          case when ok then 'PASS' else 'FAIL small payout still gated' end);

  ok := public.has_required_approvals(ws_id, 'submission', subj_id, 50000);
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'a large payout still needs two',
          case when ok is not true then 'PASS' else 'FAIL large payout ungated' end);

  -- A stranger to the workspace must see none of it. The clipper is a member
  -- for this suite, so drop them back out first.
  delete from public.workspace_members where workspace_id = ws_id and user_id = clip_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.approvals where workspace_id = ws_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'a non-member CANNOT read the workspace''s approvals',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  -- The policy itself leaks how the workspace governs its money.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.approval_policies where workspace_id = ws_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'a non-member CANNOT read the approval policy',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  -- A member cannot rewrite the bar they are being held to.
  perform set_config('request.jwt.claims', '', true);
  insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
  values (ws_id, clip_id, 'member', now())
  on conflict (workspace_id, user_id) do update set role = 'member', accepted_at = now();

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  update public.approval_policies set submission_approvals_required = 1
   where workspace_id = ws_id;
  get diagnostics n = row_count;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'a plain member CANNOT lower the approval bar',
          case when n = 0 then 'PASS' else 'FAIL updated '||n end);

  perform set_config('request.jwt.claims', '', true);
  insert into rls_results(area, check_name, outcome)
  values ('approvals', 'policy fixture note',
          case when had_policy then 'NOTE workspace already had a policy - restored by rollback'
               else 'NOTE policy created by the suite - removed by rollback' end);

end $$;

select area, check_name, outcome from rls_results order by ord;

-- Nothing above is kept.
rollback;
