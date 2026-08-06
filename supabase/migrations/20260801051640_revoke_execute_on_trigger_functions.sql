-- Stop clients being able to call trigger functions over RPC.
--
-- Supabase's security advisor flags 39 SECURITY DEFINER functions in this
-- schema as executable by `anon` and `authenticated`, which means they are
-- reachable at /rest/v1/rpc/<name>.
--
-- EXECUTE has to be revoked from all three of PUBLIC, anon and authenticated,
-- and missing any one of them achieves nothing:
--
--   * Postgres grants EXECUTE on a new function to PUBLIC by default, and both
--     roles inherit that. Revoking from the two roles alone leaves the function
--     callable through PUBLIC — checked, and has_function_privilege still
--     returned true for all 27 after a roles-only revoke.
--   * Supabase separately grants EXECUTE to anon and authenticated directly, so
--     `revoke ... from public` alone does not undo those. Several migrations
--     here already do exactly that, including the source-assets one, which is
--     why that function was still flagged despite looking handled.
--
-- The 39 split cleanly:
--
--   Trigger-only functions. Postgres calls these through the trigger
--   mechanism, which does not check EXECUTE on the caller, so revoking costs
--   nothing. That is the set handled below.
--
--   Policy helpers — is_workspace_member, workspace_role, can_review and the
--   rest. A SECURITY DEFINER function used inside an RLS policy IS permission-
--   checked against the calling role, so revoking EXECUTE there would break
--   every policy that uses it. 20260726211302_workspaces.sql grants those to
--   `authenticated` on purpose. Left alone.
--
-- Practical impact of the ones being revoked is small — most take no arguments
-- and reference NEW/OLD, so calling them over RPC errors out — but "it happens
-- to fail" is not an access control, and a few (emit_notification,
-- emit_workspace_notification) take arguments and would have written rows.
-- Those two are the reason this is worth doing rather than suppressing.

do $$
declare
  fn record;
  revoked int := 0;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef                       -- SECURITY DEFINER only
       and (
         p.proname like 'tg\_%'              -- every trigger function
         -- Trigger-only, but not named tg_*. Verified against pg_trigger and
         -- pg_event_trigger rather than assumed:
         --   handle_new_user      on_auth_user_created on auth.users
         --   emit_notification    called only from the tg_notify_* functions
         --   emit_workspace_...   same
         --   rls_auto_enable      event trigger, fires on CREATE TABLE
         or p.proname in ('handle_new_user', 'emit_notification',
                          'emit_workspace_notification', 'rls_auto_enable')
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    revoked := revoked + 1;
  end loop;

  raise notice 'Revoked EXECUTE on % trigger function(s)', revoked;
end $$;

-- Prove it, in the migration itself. A revoke that silently achieves nothing is
-- exactly the failure this migration exists to correct, and it already happened
-- once here.
do $$
declare leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and (p.proname like 'tg\_%'
          or p.proname in ('handle_new_user', 'emit_notification',
                           'emit_workspace_notification', 'rls_auto_enable'))
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if leaked is not null then
    raise exception 'Still executable by authenticated: %', leaked;
  end if;
end $$;
