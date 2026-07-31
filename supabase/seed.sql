-- Local seed. Runs after every `supabase db reset`, wired up by
-- `[db.seed] sql_paths = ["./seed.sql"]` in config.toml.
--
-- This exists for one reason: supabase/tests/rls.sql opens by picking a real
-- brand profile, a real clipper profile, and the brand's workspace, and
-- returns a single SKIP row if any of the three is missing. Against an empty
-- local database the whole suite was a no-op that still exited 0 — it looked
-- like it passed. These rows are what make the assertions run.
--
-- Never applied to a hosted project: `db reset` is local-only, and the fixed
-- UUIDs below would collide with real users if it were.
--
-- The suite creates and rolls back its own campaigns, applications, payouts and
-- approvals. Everything here is the *identity* layer it cannot invent, because
-- profiles are foreign-keyed to auth.users and RLS impersonation needs real ids.

-- Three users:
--   ...0001 brand, owns a workspace (created by the ensure_workspace_for_brand
--           trigger on profiles, so it is not inserted here)
--   ...0002 clipper, unrelated to that workspace — the outsider every deny-case
--           in the suite impersonates
--   ...0003 a second accepted member of the brand's workspace, so an approval
--           policy of min_approvals = 2 is satisfiable. Without a second body
--           the approvals section can only ever test the unsatisfiable path.
insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', 'brand@seed.local',    'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'clipper@seed.local',  'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-4000-8000-000000000003', 'teammate@seed.local', 'authenticated', 'authenticated', now(), now())
on conflict (id) do nothing;

-- Order matters: the brand profile fires ensure_workspace_for_brand, which
-- creates the workspace and the owner's workspace_members row.
insert into public.profiles (id, full_name, role)
values
  ('00000000-0000-4000-8000-000000000001', 'Seed Brand',    'brand'),
  ('00000000-0000-4000-8000-000000000002', 'Seed Clipper',  'clipper'),
  ('00000000-0000-4000-8000-000000000003', 'Seed Teammate', 'clipper')
on conflict (id) do nothing;

-- The teammate is a brand-side collaborator, not a creator, despite the
-- 'clipper' profile role — role and workspace membership are separate axes.
-- accepted_at must be set; a null there means a pending invite, which grants
-- nothing.
insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
select w.id, '00000000-0000-4000-8000-000000000003', 'admin', now()
  from public.workspaces w
 where w.owner_id = '00000000-0000-4000-8000-000000000001'
on conflict (workspace_id, user_id) do nothing;

-- A public creator profile, for the discovery/visibility checks. The handle is
-- not optional here: clipper_profiles_public_requires_handle rejects
-- is_public = true without one.
insert into public.clipper_profiles (user_id, handle, headline, bio, is_public, published_at)
values ('00000000-0000-4000-8000-000000000002', 'seed-clipper',
        'Seed clipper', 'Fixture for the RLS suite.', true, now())
on conflict (user_id) do nothing;
