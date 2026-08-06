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
  job_solo  uuid;
  job_ws    uuid;
  job_other uuid;
  mate_id   uuid;
  n2        int;
  had_policy boolean;

  procedure_note text;
begin
  -- Real users of each role. The suite is a no-op if the project has neither.
  --
  -- `order by` is load-bearing, not tidiness. A `limit 1` with no ordering picks
  -- an arbitrary row, and there is now more than one brand locally: seed.sql
  -- creates Seed Brand, and scripts/dev-session.mjs creates Dev Tester. Each
  -- owns a different workspace, and only Seed Brand's has the second member the
  -- multi-approver UI needs — so an unordered pick silently changes which
  -- workspace every fixture below is built in, run to run.
  select id into brand_id from public.profiles
   where role = 'brand'   order by updated_at, id limit 1;
  select id into clip_id  from public.profiles
   where role = 'clipper' order by updated_at, id limit 1;

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
  -- 6a-bis. Account type is chosen once and locked.
  --
  --   Every case sets role_chosen_at itself rather than trusting the fixture.
  --   The migration's backfill runs against an empty table (migrations come
  --   before seed.sql), so a case that assumed the seeded users were locked
  --   would take the first-pick-allowed branch and report PASS while asserting
  --   nothing at all.
  ---------------------------------------------------------------------------

  -- `reset role` does NOT clear request.jwt.claims, so auth.uid() is still
  -- whoever the previous section impersonated — and the guard trigger keys off
  -- exactly that. The suite's own setup writes have to run with it cleared or
  -- they hit the lock themselves.
  perform set_config('request.jwt.claims', '', true);

  -- Locked. The clipper tries to promote themselves to brand.
  update public.profiles set role_chosen_at = now() where id = clip_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.profiles set role = 'brand' where id = clip_id;
    msg := 'FAIL role change allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'user CANNOT change their own role once chosen', msg);

  -- The regression that would break every /profile save: the form still sends
  -- the row, just not a different role.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.profiles set full_name = 'Renamed', role = 'clipper' where id = clip_id;
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'user CAN still edit their name', msg);

  -- Clearing the flag is how you would reopen the pick. It must be refused,
  -- and the value must survive the attempt.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.profiles set role_chosen_at = null where id = clip_id;
    msg := 'FAIL unlock allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  select count(*) into n from public.profiles
   where id = clip_id and role_chosen_at is not null;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'user CANNOT unlock their own role',
          case when msg <> 'PASS' then msg
               when n = 1 then 'PASS'
               else 'FAIL flag was cleared' end);

  -- A fresh signup, made the way one actually happens: an auth.users insert
  -- with no 'role' metadata key, exactly what Google OAuth produces.
  -- on_auth_user_created -> handle_new_user is what creates the profile, so
  -- this asserts the new-user half of the migration rather than simulating it.
  mate_id := gen_random_uuid();
  insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
  values (mate_id, 'rls-suite-newuser@seed.local', 'authenticated', 'authenticated',
          '{"full_name":"RLS Suite Newcomer"}'::jsonb, now(), now());

  select count(*) into n from public.profiles
   where id = mate_id and role = 'clipper' and role_chosen_at is null;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'a Google signup arrives unchosen',
          case when n = 1 then 'PASS' else 'FAIL not unchosen' end);

  -- The other half: a signup that DOES carry the key was chosen deliberately
  -- (seed.sql and scripts/dev-session.mjs are the only two). If this regresses,
  -- every local fixture becomes unchosen, the gate redirects them all to the
  -- picker, and the lock cases above quietly test the wrong branch.
  declare meta_id uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
    values (meta_id, 'rls-suite-chosen@seed.local', 'authenticated', 'authenticated',
            '{"full_name":"RLS Suite Chosen","role":"brand"}'::jsonb, now(), now());

    select count(*) into n from public.profiles
     where id = meta_id and role = 'brand' and role_chosen_at is not null;
    insert into rls_results(area, check_name, outcome)
    values ('account type', 'a signup with an explicit role arrives chosen',
            case when n = 1 then 'PASS' else 'FAIL not chosen' end);
  end;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', mate_id, 'role','authenticated')::text, true);
  begin
    update public.profiles set role = 'brand', role_chosen_at = now() where id = mate_id;
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'a new user CAN pick their role once', msg);

  -- Picking brand has to produce a workspace, or the brand side of the app is
  -- empty for them. ensure_workspace_for_brand is what does it.
  select count(*) into n from public.workspaces w where w.owner_id = mate_id;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'picking brand creates a workspace',
          case when n >= 1 then 'PASS' else 'FAIL no workspace' end);

  -- Picking CLIPPER takes a different branch: role already reads 'clipper' by
  -- default, so only role_chosen_at moves. A reordering of the guard that still
  -- let brand through could silently break every clipper signup.
  declare pick_id uuid := gen_random_uuid();
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
    values (pick_id, 'rls-suite-picks-clipper@seed.local', 'authenticated', 'authenticated',
            '{"full_name":"RLS Suite Clipper Pick"}'::jsonb, now(), now());

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', pick_id, 'role','authenticated')::text, true);
    begin
      update public.profiles set role = 'clipper', role_chosen_at = now() where id = pick_id;
      msg := 'PASS';
    exception when others then msg := 'FAIL ' || sqlstate;
    end;
    reset role;

    select count(*) into n from public.profiles
     where id = pick_id and role_chosen_at is not null;
    insert into rls_results(area, check_name, outcome)
    values ('account type', 'a new user CAN pick clipper',
            case when msg <> 'PASS' then msg
                 when n = 1 then 'PASS'
                 else 'FAIL flag not set' end);
  end;

  -- ...and the second attempt is refused, by the same person, immediately.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', mate_id, 'role','authenticated')::text, true);
  begin
    update public.profiles set role = 'clipper' where id = mate_id;
    msg := 'FAIL second change allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'CANNOT change it again after picking', msg);

  -- The escape hatch: /api/admin/users/[id]/role runs on the service-role
  -- client, where auth.uid() is null. If this stops working, a role picked
  -- wrongly at signup can only be fixed with a psql session against prod.
  -- Clearing the claims is what makes auth.uid() null — that IS the case.
  perform set_config('request.jwt.claims', '', true);
  begin
    update public.profiles set role = 'clipper' where id = mate_id;
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  insert into rls_results(area, check_name, outcome)
  values ('account type', 'the admin client CAN change a locked role', msg);

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

  -- Marking read, one row at a time. The update policy existed from the start
  -- but nothing exercised it until /notifications got a per-item control.
  perform set_config('request.jwt.claims', '', true);
  insert into public.notifications (user_id, kind, title)
  values (clip_id, 'message_received', 'Probe: mark me read')
  returning id into subj_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  update public.notifications set read_at = now()
   where id = subj_id and user_id = clip_id and read_at is null;
  reset role;
  select count(*) into n from public.notifications
   where id = subj_id and read_at is not null;
  insert into rls_results(area, check_name, outcome)
  values ('notifications', 'user CAN mark their own notification read',
          case when n = 1 then 'PASS' else 'FAIL not marked' end);

  -- Somebody else's. The policy FILTERS rather than raising, so the statement
  -- succeeds having touched nothing — asserting "no error" would pass
  -- vacuously. The row itself has to be re-read.
  --
  -- Verified failable, and the result is worth recording: widening the UPDATE
  -- policy to `using (true)` alone does NOT make this red. An UPDATE with a
  -- WHERE clause has to read the row first, so the SELECT policy gates it too
  -- and the write still matches nothing. Both policies have to be widened
  -- before this turns. Do not "simplify" either one on the assumption that the
  -- other is what is holding the line.
  perform set_config('request.jwt.claims', '', true);
  insert into public.notifications (user_id, kind, title)
  values (brand_id, 'message_received', 'Probe: not yours')
  returning id into subj_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  update public.notifications set read_at = now() where id = subj_id;
  get diagnostics n = row_count;
  reset role;

  select count(*) into n2 from public.notifications
   where id = subj_id and read_at is null;
  insert into rls_results(area, check_name, outcome)
  values ('notifications', 'user CANNOT mark another user''s notification read',
          case when n <> 0 then 'FAIL updated ' || n || ' row(s)'
               when n2 = 1 then 'PASS'
               else 'FAIL read_at was set' end);

  ---------------------------------------------------------------------------
  -- 6c. Notification preferences. The sound switch on /notifications is the
  --     first client write this table has ever had, and it upserts — so the
  --     insert half of the policy matters as much as the update half.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.notification_preferences (user_id, sound_enabled)
    values (clip_id, false)
    on conflict (user_id) do update set sound_enabled = excluded.sound_enabled;
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('notification_preferences', 'user CAN upsert their own sound setting', msg);

  -- Muting someone else's chime is small, but it is a write into another
  -- user's settings row and the policy has to refuse it.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.notification_preferences (user_id, sound_enabled)
    values (brand_id, false);
    msg := 'FAIL insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('notification_preferences', 'user CANNOT write another user''s settings', msg);

  -- The brand's row, written outside any role so RLS does not apply, must be
  -- invisible to the clipper.
  insert into public.notification_preferences (user_id, sound_enabled)
  values (brand_id, false)
  on conflict (user_id) do update set sound_enabled = excluded.sound_enabled;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.notification_preferences where user_id = brand_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('notification_preferences', 'user CANNOT read another user''s settings',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  ---------------------------------------------------------------------------
  -- 6d. Realtime delivery. Not a policy, but the step that gets forgotten:
  --     without the table in the publication the subscription connects and
  --     silently receives nothing, which looks exactly like a client bug.
  ---------------------------------------------------------------------------
  select count(*) into n from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('messages', 'notifications');
  insert into rls_results(area, check_name, outcome)
  values ('realtime', 'messages and notifications are replicated',
          case when n = 2 then 'PASS' else 'FAIL only '||n||' of 2' end);

  ---------------------------------------------------------------------------
  -- 7. Bids are visible only to the campaign owner.
  ---------------------------------------------------------------------------
  -- Fixture, not an assertion. Clear the claim first: set_config(..., true) is
  -- TRANSACTION-local, so an earlier check's JWT is still in effect here, and
  -- guard_application_terms (which freezes bid_amount for any caller with an
  -- auth.uid()) would refuse this setup write.
  perform set_config('request.jwt.claims', '', true);

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

  ---------------------------------------------------------------------------
  -- 9. AI jobs. Two things are being checked, and they fail differently.
  --
  --    Reads: a job has two possible owners and only one is guaranteed, so
  --    there are two OR-ed select policies. The case that matters is the
  --    workspace-less job — a clipper's quality score — which only the
  --    user_id policy can reach.
  --
  --    Writes: there is no insert/update/delete policy at all, by design.
  --    Note the asymmetry in how that surfaces: INSERT fails loudly on the
  --    missing WITH CHECK, while UPDATE silently matches zero rows, because
  --    USING filters the row out before it is ever considered. A test that
  --    expected an exception from the UPDATE would report a false failure.
  ---------------------------------------------------------------------------
  -- The approvals section above made the clipper an accepted member of ws_id
  -- to get a second approver, and left them there. Every "non-member" check
  -- below would otherwise be run as a member and pass for the wrong reason —
  -- which is exactly what happened first time round: three of them reported
  -- FAIL and the policies were fine. Undo it here rather than in the approvals
  -- section, which still needs the membership while it runs.
  perform set_config('request.jwt.claims', '', true);
  delete from public.workspace_members where workspace_id = ws_id and user_id = clip_id;

  -- Three jobs, and the ownership of each is chosen so that exactly one policy
  -- can grant each read. The first version of this section got that wrong:
  -- the workspace job was owned by the same user who then read it, so it
  -- passed with the workspace policy dropped — the user_id policy was quietly
  -- carrying it, and the check proved nothing about the thing it named.
  --
  --   job_solo  no workspace, owned by the clipper   -> only the user policy
  --   job_ws    ws_id,        owned by the clipper   -> only the workspace
  --                                                     policy can show it to
  --                                                     the brand
  --   job_other ws_id,        owned by the brand     -> the clipper is neither
  --                                                     owner nor member, so
  --                                                     neither policy applies
  insert into public.ai_jobs (workspace_id, user_id, kind, status)
  values (null, clip_id, 'quality_score', 'queued')
  returning id into job_solo;

  insert into public.ai_jobs (workspace_id, user_id, kind, status)
  values (ws_id, clip_id, 'transcribe', 'queued')
  returning id into job_ws;

  insert into public.ai_jobs (workspace_id, user_id, kind, status)
  values (ws_id, brand_id, 'highlight_detect', 'queued')
  returning id into job_other;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.ai_jobs where id = job_solo;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('ai jobs', 'clipper reads their own workspace-less job',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.ai_jobs where id = job_solo;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('ai jobs', 'another user CANNOT read that job',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.ai_jobs where id = job_ws;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('ai jobs', 'workspace member reads a job they did not create',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.ai_jobs where id = job_other;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('ai jobs', 'non-member CANNOT read the workspace job',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.ai_jobs (workspace_id, user_id, kind)
    values (null, clip_id, 'quality_score');
    msg := 'FAIL insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('ai jobs', 'client CANNOT insert a job', msg);

  -- The money line. If a client could write these, it could mark its own job
  -- succeeded and bill itself nothing.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  update public.ai_jobs
     set status = 'succeeded', completed_at = now(), credits_charged = 0
   where id = job_solo;
  get diagnostics n = row_count;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('ai jobs', 'client CANNOT mark its own job succeeded',
          case when n = 0 then 'PASS' else 'FAIL updated '||n end);

  -- Not RLS, but the invariant a poller depends on: a terminal row must carry
  -- a completion time, or it looks in-flight for ever.
  begin
    update public.ai_jobs set status = 'succeeded' where id = job_other;
    msg := 'FAIL terminal status without completed_at allowed';
  exception when check_violation then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  insert into rls_results(area, check_name, outcome)
  values ('ai jobs', 'succeeded REQUIRES completed_at', msg);

  ---------------------------------------------------------------------------
  -- 10. Brand voice. Workspace-scoped, members manage it, nobody else sees it.
  ---------------------------------------------------------------------------
  insert into public.brand_voice (workspace_id, tone, banned_terms)
  values (ws_id, 'Direct, dry', array['revolutionary','game-changing'])
  on conflict (workspace_id) do update set tone = excluded.tone;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.brand_voice where workspace_id = ws_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('brand voice', 'workspace member reads the brand voice',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.brand_voice where workspace_id = ws_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('brand voice', 'non-member CANNOT read the brand voice',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.brand_voice (workspace_id, tone)
    values (ws_id, 'Whatever the clipper wants');
    msg := 'FAIL insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when unique_violation then msg := 'FAIL row was visible enough to collide';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('brand voice', 'non-member CANNOT write the brand voice', msg);

  ---------------------------------------------------------------------------
  -- 11. Source assets. The interesting part is not membership — it is the
  --     split between what the brand owns and what the pipeline owns. A member
  --     may upload and rename; only the pipeline may declare a file
  --     transcribed. RLS cannot express "every column except these five", so a
  --     trigger does, and a trigger is exactly the kind of thing that silently
  --     stops working.
  --
  --     The clipper is still a non-member here, removed in section 9.
  ---------------------------------------------------------------------------
  insert into public.source_assets (workspace_id, uploaded_by, storage_path, filename)
  values (ws_id, brand_id, ws_id || '/rls-suite/episode.mp4', 'episode.mp4')
  returning id into subj_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.source_assets where id = subj_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('source assets', 'workspace member reads the asset',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.source_assets where id = subj_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('source assets', 'non-member CANNOT read the asset',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  -- Renaming is the brand's business.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    update public.source_assets set filename = 'renamed.mp4' where id = subj_id;
    get diagnostics n = row_count;
    msg := case when n = 1 then 'PASS' else 'FAIL updated '||n end;
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('source assets', 'member CAN rename their own asset', msg);

  -- The one that matters. A member who could set status and transcript could
  -- hand the highlight detector a script it never transcribed.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    update public.source_assets
       set status = 'ready', transcript = '{"forged": true}'::jsonb
     where id = subj_id;
    msg := 'FAIL member set status and transcript';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('source assets', 'member CANNOT write pipeline columns', msg);

  -- The pipeline runs with no auth.uid(), which is what the trigger keys on.
  perform set_config('request.jwt.claims', '', true);
  begin
    update public.source_assets
       set status = 'ready', transcript = '{"segments": []}'::jsonb, duration_seconds = 5400
     where id = subj_id;
    get diagnostics n = row_count;
    msg := case when n = 1 then 'PASS' else 'FAIL updated '||n end;
  exception when others then msg := 'FAIL ' || sqlstate || ' ' || left(sqlerrm, 60);
  end;
  insert into rls_results(area, check_name, outcome)
  values ('source assets', 'the pipeline CAN write those columns', msg);

  -- An insert is only allowed in the state an upload really starts in.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.source_assets
      (workspace_id, uploaded_by, storage_path, filename, status, transcript)
    values (ws_id, brand_id, ws_id || '/rls-suite/forged.mp4', 'forged.mp4',
            'ready', '{"forged": true}'::jsonb);
    msg := 'FAIL insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('source assets', 'CANNOT register an asset as already ready', msg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.source_assets (workspace_id, uploaded_by, storage_path, filename)
    values (ws_id, clip_id, ws_id || '/rls-suite/outsider.mp4', 'outsider.mp4');
    msg := 'FAIL insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('source assets', 'non-member CANNOT register an asset', msg);

  ---------------------------------------------------------------------------
  -- 12. Highlight candidates. Same model/human split as source_assets, one
  --     step further out: the model proposes the moment and its bounds, the
  --     brand only picks. If a member could rewrite start/end or the quote,
  --     slice 5 would generate a brief for a moment that never happens in the
  --     recording — so the interesting checks here are the column guard, not
  --     membership.
  --
  --     The clipper is still a non-member; section 9 removed them.
  ---------------------------------------------------------------------------
  insert into public.highlight_candidates
    (source_asset_id, start_seconds, end_seconds, title, rationale, quote)
  values (subj_id, 60, 105, 'Pricing claim', 'Stands alone.', 'Nobody tells you this')
  returning id into job_solo;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.highlight_candidates where id = job_solo;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'workspace member reads candidates',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.highlight_candidates where id = job_solo;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'non-member CANNOT read candidates',
          case when n = 0 then 'PASS' else 'FAIL leaked '||n end);

  -- Picking is the product. This must work.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    update public.highlight_candidates set selected = true where id = job_solo;
    get diagnostics n = row_count;
    msg := case when n = 1 then 'PASS' else 'FAIL updated '||n end;
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'member CAN pick a moment', msg);

  -- The one that matters: rewriting the moment itself.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    update public.highlight_candidates
       set start_seconds = 0, end_seconds = 20, quote = 'something never said'
     where id = job_solo;
    msg := 'FAIL member rewrote the moment';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'member CANNOT rewrite the moment', msg);

  -- Added after the fact: the original guard protected the moment but not
  -- campaign_id, so a member could point a moment at any campaign they liked —
  -- including one in another workspace, since the update policy only checks
  -- membership of the *asset*. Linking is what brief generation does, and that
  -- is pipeline work.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    update public.highlight_candidates set campaign_id = c_public where id = job_solo;
    msg := 'FAIL member linked a moment to a campaign';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'member CANNOT link a moment to a campaign', msg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.highlight_candidates
      (source_asset_id, start_seconds, end_seconds, title)
    values (subj_id, 0, 30, 'Forged moment');
    msg := 'FAIL insert allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'member CANNOT invent a moment', msg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  delete from public.highlight_candidates where id = job_solo;
  get diagnostics n = row_count;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'member CANNOT delete a moment',
          case when n = 0 then 'PASS' else 'FAIL deleted '||n end);

  -- Not RLS, but the invariant the player and the brief both assume.
  begin
    insert into public.highlight_candidates (source_asset_id, start_seconds, end_seconds)
    values (subj_id, 90, 30);
    msg := 'FAIL backwards moment allowed';
  exception when check_violation then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  insert into rls_results(area, check_name, outcome)
  values ('highlights', 'a moment CANNOT end before it starts', msg);

  ---------------------------------------------------------------------------
  -- 9. Membership cannot be pre-accepted on someone else's behalf.
  --    guard_member_self_update covers UPDATE only; guard_member_insert is
  --    what stops an owner inserting a row that is already accepted.
  --    clip_id was removed from the workspace in section 0, so it is free.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
    values (ws_id, clip_id, 'member', now());
    msg := 'FAIL preset accepted_at allowed';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'owner CANNOT preset accepted_at on a new member', msg);

  -- Positive control. Without it, a guard that rejects every insert reads green.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
    values (ws_id, clip_id, 'member', null);
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('workspaces', 'owner CAN still invite a new member', msg);

  perform set_config('request.jwt.claims', '', true);
  delete from public.workspace_members where workspace_id = ws_id and user_id = clip_id;

  ---------------------------------------------------------------------------
  -- 10. Schema invariants that no policy expresses.
  ---------------------------------------------------------------------------

  -- ALTER DEFAULT PRIVILEGES grants anon ALL on every new table in public, so a
  -- table created without RLS is anon-writable. This trigger is the net under
  -- that, and it lived only as dashboard state until 20260805173443.
  insert into rls_results(area, check_name, outcome)
  values ('schema', 'ensure_rls event trigger exists and is enabled',
          case when exists (select 1 from pg_event_trigger
                             where evtname = 'ensure_rls' and evtenabled <> 'D')
               then 'PASS' else 'FAIL missing or disabled' end);

  -- The case that would have caught check_handle_not_reserved keeping its
  -- grant, and that catches the next one for free. Reachability, not names --
  -- the name predicate is what let the original sweep pass while leaking.
  select string_agg(p.proname, ', ' order by p.proname) into msg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and (exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
          or exists (select 1 from pg_event_trigger e where e.evtfoid = p.oid))
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE'));
  insert into rls_results(area, check_name, outcome)
  values ('schema', 'no trigger function is EXECUTE-able by anon/authenticated',
          case when msg is null then 'PASS' else 'FAIL ' || msg end);

  ---------------------------------------------------------------------------
  -- 11. URL columns reject non-http(s) schemes.
  --     portfolio_items renders as <img src> and href on the anon-readable
  --     /c/[handle] page, and React does not sanitise <img src>.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.portfolio_items (user_id, source, thumbnail_url, video_url)
    values (clip_id, 'manual', 'javascript:alert(1)', 'https://youtube.com/watch?v=dQw4w9WgXcQ');
    msg := 'FAIL javascript: thumbnail accepted';
  exception when check_violation then msg := 'PASS';
           when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('urls', 'portfolio thumbnail CANNOT be a javascript: URL', msg);

  -- Positive control, same reason as above.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    insert into public.portfolio_items (user_id, source, thumbnail_url, video_url)
    values (clip_id, 'manual', 'https://i.ytimg.com/vi/x/default.jpg',
            'https://youtube.com/watch?v=dQw4w9WgXcQ');
    msg := 'PASS';
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('urls', 'portfolio CAN still store a normal https URL', msg);

  ---------------------------------------------------------------------------
  -- 12. The payee cannot write the numbers that decide their own payout.
  --     approve/route.js reads every one of these on the SERVICE-ROLE client,
  --     so RLS does not protect them there — these guards are the only thing
  --     standing between a clipper and their own payout amount.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);

  insert into public.youtube_connections (user_id, payout_multiplier, verification_method)
  values (clip_id, 0.75, 'bio_code')
  on conflict (user_id) do update set payout_multiplier = 0.75;

  insert into public.youtube_videos (user_id, video_id, view_count)
  values (clip_id, 'seedvideo01', 1000)
  on conflict (user_id, video_id) do update set view_count = 1000;

  insert into public.clipper_payout_accounts (user_id, status, razorpay_account_id)
  values (clip_id, 'pending', 'acc_seed')
  on conflict (user_id) do update set status = 'pending';

  -- view_count: the per-view multiplier. No client write policy survives, so
  -- the write is filtered to zero rows rather than raising.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.youtube_videos set view_count = 999999999
     where user_id = clip_id and video_id = 'seedvideo01';
    get diagnostics n = row_count;
    msg := case when n = 0 then 'PASS' else 'FAIL wrote '||n end;
  exception when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('money', 'clipper CANNOT inflate their own view_count', msg);

  -- payout_multiplier is a direct multiplier on the final rupee figure.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    -- 1.0, not some absurd number: the range CHECK would reject 1000 on its
    -- own, so this case would pass with the trigger dropped and prove nothing.
    -- 1.0 is the real attack anyway — quietly upgrading off the bio_code
    -- discount to the full rate.
    update public.youtube_connections set payout_multiplier = 1.0
     where user_id = clip_id;
    msg := 'FAIL multiplier rewritten';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('money', 'clipper CANNOT raise their own payout multiplier', msg);

  -- status='active' + an arbitrary razorpay_account_id skipped KYC entirely and
  -- redirected the transfer.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.clipper_payout_accounts
       set status = 'active', razorpay_account_id = 'acc_attacker'
     where user_id = clip_id;
    msg := 'FAIL self-activated payout account';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('money', 'clipper CANNOT self-activate their payout account', msg);

  -- Positive control: the KYC columns the user really does own stay writable,
  -- or the guard is just breaking the feature.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.clipper_payout_accounts set contact_name = 'Updated Name'
     where user_id = clip_id;
    get diagnostics n = row_count;
    msg := case when n = 1 then 'PASS' else 'FAIL wrote '||n end;
  exception when others then msg := 'FAIL ' || sqlstate;
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('money', 'clipper CAN still edit their own KYC details', msg);

  -- bid_amount is agreedRate in approve/route.js. The workspace UPDATE policy
  -- has no column scope, so a `member` could rewrite the agreed price.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  begin
    update public.campaign_applications set bid_amount = 999999
     where campaign_id = c_invite and clipper_id = clip_id;
    msg := 'FAIL bid rewritten';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('money', 'workspace member CANNOT rewrite an agreed bid', msg);

  ---------------------------------------------------------------------------
  -- 13. An invitation can be answered, not retargeted.
  --     Repointing campaign_id made is_invited_to_campaign() true for any
  --     campaign, which grants both read and apply on invite-only campaigns.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  insert into public.campaign_invites (campaign_id, clipper_id, invited_by)
  values (c_invite, clip_id, brand_id)
  on conflict (campaign_id, clipper_id) do nothing;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  begin
    update public.campaign_invites set campaign_id = c_public
     where clipper_id = clip_id and campaign_id = c_invite;
    msg := 'FAIL invite retargeted';
  exception when insufficient_privilege then msg := 'PASS';
           when others then msg := 'PASS (' || sqlstate || ')';
  end;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('invites', 'recipient CANNOT repoint an invite at another campaign', msg);

  ---------------------------------------------------------------------------
  -- 14. Two helpers that answered questions for anonymous callers.
  ---------------------------------------------------------------------------
  select string_agg(p.proname, ', ' order by p.proname) into msg
    from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public'
     and p.proname in ('workspace_owner', 'has_required_approvals')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  insert into rls_results(area, check_name, outcome)
  values ('rpc', 'owner/approval oracles are not callable from PostgREST',
          case when msg is null then 'PASS' else 'FAIL ' || msg end);

  ---------------------------------------------------------------------------
  -- 15. brand_profiles positioning is workspace-scoped; identity is not.
  ---------------------------------------------------------------------------
  -- seed.sql creates no brand_profiles row, so without this fixture BOTH checks
  -- below read zero rows and the negative one passes for the wrong reason —
  -- which is exactly what happened the first time this was written.
  perform set_config('request.jwt.claims', '', true);
  insert into public.brand_profiles (user_id, workspace_id, company_name, logo_url, guidelines)
  values (brand_id, ws_id, 'Seed Brand Co', 'https://example.com/logo.png',
          'Internal positioning that must not leak')
  on conflict (user_id) do update
     set workspace_id = ws_id, company_name = 'Seed Brand Co';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', clip_id, 'role','authenticated')::text, true);
  select count(*) into n from public.brand_profiles where user_id = brand_id;
  select count(*) into n2 from public.brand_public where user_id = brand_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('brand', 'non-member CANNOT read brand positioning',
          case when n = 0 then 'PASS' else 'FAIL saw '||n end);
  insert into rls_results(area, check_name, outcome)
  values ('brand', 'non-member CAN still read brand display identity',
          case when n2 = 1 then 'PASS' else 'FAIL saw '||n2 end);

  ---------------------------------------------------------------------------
  -- 16. An unlisted creator profile needs a relationship, not a self-declared
  --     role. The old policy let anyone who picked 'brand' at signup read every
  --     private profile.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  insert into public.clipper_profiles (user_id, is_public, bio, handle)
  values (clip_id, false, 'Unlisted bio', 'seed-unlisted-handle')
  on conflict (user_id) do update set is_public = false, bio = 'Unlisted bio';

  -- mate_id is a workspace member but has no campaign relationship with clip_id
  -- beyond the invite-only campaign, so clear that first to isolate the check.
  delete from public.campaign_applications where clipper_id = clip_id;
  delete from public.campaign_invites where clipper_id = clip_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.clipper_profiles where user_id = clip_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('creators', 'brand with no engagement CANNOT read an unlisted profile',
          case when n = 0 then 'PASS' else 'FAIL saw '||n end);

  -- Positive control: once that creator applies to one of the brand's
  -- campaigns, the brand must be able to read the profile they are judging.
  perform set_config('request.jwt.claims', '', true);
  insert into public.campaign_applications (campaign_id, clipper_id)
  values (c_invite, clip_id)
  on conflict (campaign_id, clipper_id) do nothing;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.clipper_profiles where user_id = clip_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('creators', 'brand CAN read the profile of someone who applied',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

  -- The /clippers directory selects clipper_profiles with no is_public filter,
  -- so it leaned entirely on the dropped "Brands can view all" policy. This is
  -- the case that catches over-tightening: a PUBLIC profile must stay visible
  -- to a brand with no relationship at all, or the directory goes empty.
  perform set_config('request.jwt.claims', '', true);
  delete from public.campaign_applications where clipper_id = clip_id;
  update public.clipper_profiles set is_public = true where user_id = clip_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', brand_id, 'role','authenticated')::text, true);
  select count(*) into n from public.clipper_profiles where user_id = clip_id;
  reset role;
  insert into rls_results(area, check_name, outcome)
  values ('creators', 'the public directory is still readable by any brand',
          case when n = 1 then 'PASS' else 'FAIL saw '||n end);

end $$;

select area, check_name, outcome from rls_results order by ord;

-- Nothing above is kept.
rollback;
