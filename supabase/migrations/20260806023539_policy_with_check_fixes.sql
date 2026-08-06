-- ---------------------------------------------------------------------------
-- Three UPDATE policies whose WITH CHECK is narrower than their INSERT check
-- ---------------------------------------------------------------------------
--
-- The recurring shape: an INSERT policy correctly calls a SECURITY DEFINER
-- helper to prove eligibility, and the matching UPDATE policy checks only
-- ownership. Since the row's identity columns are not frozen, the author can
-- edit a legitimately-created row into one they were never allowed to create.
--
-- Postgres reuses USING for WITH CHECK when the latter is absent, so the
-- dangerous cases are the ones where a WITH CHECK exists but forgot a term.

-- ---------------------------------------------------------------------------
-- 1. campaign_invites -- a recipient could repoint their invite at any campaign
-- ---------------------------------------------------------------------------
--
-- "Recipients respond to their invites" (20260726185312) constrains clipper_id
-- on both sides and says nothing about campaign_id. A clipper holding ONE
-- invite could PATCH it to any campaign uuid; is_invited_to_campaign() then
-- returned true, which grants both read ("Invited clippers can view the
-- campaign") and write ("Clippers can apply to funded active campaigns").
--
-- That defeats exactly the threat 20260726185312's own comment names: "A
-- clipper who learned an invite-only campaign's id could apply to it." The
-- unique (campaign_id, clipper_id) index does not prevent it.
--
-- The response is status/responded_at. Everything identifying the invite is
-- frozen, which RLS cannot express -- hence a trigger.

create or replace function public.tg_freeze_invite_target()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  caller := (select auth.uid());
  if caller is null then return new; end if;

  if new.campaign_id is distinct from old.campaign_id
     or new.clipper_id  is distinct from old.clipper_id
     or new.invited_by  is distinct from old.invited_by then
    raise exception 'An invitation can be answered, not retargeted'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end; $$;

drop trigger if exists freeze_invite_target on public.campaign_invites;
create trigger freeze_invite_target
  before update on public.campaign_invites
  for each row execute function public.tg_freeze_invite_target();

revoke execute on function public.tg_freeze_invite_target() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. reviews -- the edit window let an author plant a review on anyone
-- ---------------------------------------------------------------------------
--
-- INSERT requires can_review(application_id, direction, subject_id): a released
-- payout, and the author actually being the counterparty. The one-hour
-- "correct your unpublished review" UPDATE checked only author_id and
-- not is_published -- so within that window the author could rewrite
-- subject_id, application_id, direction, rating and body freely.
--
-- Leaving the counterpart review unwritten keeps tg_reviews_publish_pair from
-- firing, and the SELECT policy publishes it to anon anyway after 14 days,
-- where creator_stats.avg_rating counts it. There is no delete policy on
-- reviews by design. One completed payout bought a permanent public review
-- planted on an arbitrary user.
--
-- Repeating can_review in the WITH CHECK is the whole fix: the edited row must
-- still be a review the author was entitled to write.

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
    and public.can_review(application_id, direction, subject_id)
  );

-- ---------------------------------------------------------------------------
-- 3. messages -- a sender could move their message into any conversation
-- ---------------------------------------------------------------------------
--
-- INSERT requires can_access_conversation(conversation_id). UPDATE checked only
-- sender_id, so a user could PATCH one of their own messages into a private
-- brand/creator thread they have no access to. messages is in the
-- supabase_realtime publication, so the injected row is pushed live to everyone
-- subscribed to that conversation. The attacker cannot read the thread back,
-- which makes it a one-way impersonation primitive rather than a leak.

drop policy if exists "Senders can edit their own messages" on public.messages;
create policy "Senders can edit their own messages"
  on public.messages for update
  to authenticated
  using (sender_id = (select auth.uid()))
  with check (
    sender_id = (select auth.uid())
    and public.can_access_conversation(conversation_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Two SECURITY DEFINER helpers answer questions for anonymous callers
-- ---------------------------------------------------------------------------
--
-- 20260725075602 issues `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO
-- anon`, and the per-function hardening in 20260726211302/20260726232010 only
-- revoked from `public` -- which does not remove Supabase's direct grant to
-- anon. Confirmed from live pg_proc.proacl: both still carry anon=X.
--
-- Nine of the eleven policy helpers reference auth.uid() and so return
-- false/null for an anonymous caller. These two do not:
--
--   workspace_owner(ws)          `select owner_id from workspaces where id = ws`
--                                -- the owner's user id for ANY workspace uuid,
--                                unauthenticated. Used by no policy and no app
--                                code: it is dead weight, so it loses EXECUTE
--                                entirely rather than being narrowed.
--
--   has_required_approvals(...)  an approval-state and threshold-policy oracle.
--                                Called only from approve/route.js on the
--                                service-role client, so authenticated does not
--                                need it either.
--
-- Policy helpers are deliberately untouched: a definer function called inside
-- an RLS policy IS permission-checked against the caller, so is_workspace_member
-- and friends must keep their grant to authenticated.

revoke execute on function public.workspace_owner(uuid)
  from public, anon, authenticated;

revoke execute on function public.has_required_approvals(uuid, text, uuid, numeric)
  from public, anon, authenticated;

do $$
declare leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('workspace_owner', 'has_required_approvals')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if leaked is not null then
    raise exception 'Still reachable at /rest/v1/rpc: %', leaked;
  end if;
end $$;
