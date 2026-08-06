-- ---------------------------------------------------------------------------
-- Two pieces of drift between this repo and the live database
-- ---------------------------------------------------------------------------
--
-- 1. The `ensure_rls` event trigger exists on the hosted project and nowhere in
--    these migrations, so a local `supabase db reset` produces a database
--    without it -- and supabase/tests/rls.sql validates a schema that differs
--    from production in exactly the place that matters most.
--
-- 2. 20260801051640 revoked EXECUTE on "every trigger function" by matching on
--    NAMES. check_handle_not_reserved() does not start with tg_ and was not in
--    the explicit list, so it kept the PUBLIC grant plus anon and authenticated
--    (confirmed from live pg_proc.proacl: `=X/postgres | ... | anon=X/postgres
--    | authenticated=X/postgres`). Its self-verification block reused the same
--    name predicate, so it could never have caught its own omission -- the
--    migration reported success while leaving a function behind.
--
--    That function returns `trigger`, so PostgREST almost certainly never
--    exposed it at /rest/v1/rpc. This is defense-in-depth and restoring the
--    sweep's stated invariant, not closing a live exploit.
--
-- Section 1 must run before section 2: the new predicate finds rls_auto_enable
-- via pg_event_trigger, so on a fresh reset the trigger has to exist first.

-- ---------------------------------------------------------------------------
-- 1. The event trigger that auto-enables RLS on every new table
-- ---------------------------------------------------------------------------
--
-- Matches production exactly: ddl_command_end, tags CREATE TABLE / CREATE TABLE
-- AS / SELECT INTO, owner postgres. The function itself already lives in
-- 20260725075602_remote_schema.sql.
--
-- Postgres has no CREATE EVENT TRIGGER IF NOT EXISTS, hence the guard. That
-- also makes this a no-op against the hosted project, which sidesteps the fact
-- that creating an event trigger normally requires superuser -- if some future
-- environment genuinely needs it created and the role cannot, this fails there
-- loudly rather than drifting silently.
--
-- This matters more than it looks: 20260725075602 issues
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon`, so a table
-- created without RLS is anon-readable and anon-writable. This trigger is the
-- net under that.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-run the EXECUTE sweep, matching on reachability instead of on names
-- ---------------------------------------------------------------------------
--
-- A SECURITY DEFINER function attached to a trigger or event trigger is invoked
-- by the trigger mechanism, which does not check EXECUTE. So nothing needs the
-- grant, and anything holding it is reachable at /rest/v1/rpc for no reason.
--
-- Matching on "is it attached to a trigger" is self-maintaining in a way that
-- matching on "is it called tg_something" is not. emit_notification and
-- emit_workspace_notification stay listed explicitly: they are attached to
-- nothing and are called from inside the tg_notify_* functions.
--
-- Policy helpers are deliberately NOT swept. A definer function called inside
-- an RLS policy IS permission-checked against the caller, so is_workspace_member
-- and friends must keep their grant to authenticated or every policy using them
-- breaks.
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
       and p.prosecdef
       and (
         exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
         or exists (select 1 from pg_event_trigger e where e.evtfoid = p.oid)
         or p.proname in ('emit_notification', 'emit_workspace_notification')
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    revoked := revoked + 1;
  end loop;

  raise notice 'Revoked EXECUTE on % trigger function(s)', revoked;
end $$;

-- Prove it, with the SAME predicate the sweep used -- that symmetry is the
-- whole point. 20260801051640 asserted with its name predicate and so could
-- only ever confirm what it had already decided to look at.
do $$
declare leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and (
       exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
       or exists (select 1 from pg_event_trigger e where e.evtfoid = p.oid)
       or p.proname in ('emit_notification', 'emit_workspace_notification')
     )
     and (
       has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE')
     );

  if leaked is not null then
    raise exception 'Still EXECUTE-able by anon or authenticated: %', leaked;
  end if;
end $$;
