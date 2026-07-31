-- Capture three things that exist on the live project but were created through
-- the dashboard and so were never in a migration file. `supabase db diff
-- --linked` surfaced them: a fresh `db reset` produced a database that did not
-- match production, which quietly invalidates every RLS assertion run against
-- it.
--
-- Everything here is written to be a no-op against the live project, which
-- already has all of it — apply it there too so the two stay in step.
--
-- Deliberately NOT included, though the diff listed them:
--   * `drop extension pg_net` — pg_net is a local-stack default and is simply
--     absent on the hosted project. Dropping it locally to match would remove a
--     working extension to achieve nothing.
--   * ~20 `create or replace function` statements for the workspace and
--     notification helpers. Their bodies are identical to the committed
--     migrations once whitespace is normalised; the diff tool re-emits a
--     function whenever formatting differs. Verified by comparing
--     `pg_get_functiondef` locally against the diff output.

-- 1. The avatars bucket. `src/lib/storage.js` uploads to it on every profile
--    and brand-logo save, and no migration has ever created it — local uploads
--    failed with "Bucket not found" while production worked.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- The first path segment is the owner's user id — uploadPublicImage() writes
-- `${userId}/${stem}.${ext}` — which is what makes these policies work. Same
-- shape as the brand-assets policies, which key on workspace id instead.
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'avatars'
    and (select auth.uid()::text) = (storage.foldername(name))[1]
  );

-- 2. The signup trigger. public.handle_new_user() was in the baseline schema
--    dump, but the trigger that calls it was not — so on a local stack a new
--    Google sign-in created an auth.users row and no profiles row. Every
--    downstream query keys off profiles, including the role check in
--    requireRole() and the ensure_workspace_for_brand trigger, so the account
--    came up broken in a way that looks like an app bug.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
