drop extension if exists "pg_net";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.can_access_conversation(conv_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.conversations c
      join public.campaign_applications ca on ca.id = c.application_id
      join public.campaigns cm on cm.id = ca.campaign_id
     where c.id = conv_id
       and (
         ca.clipper_id = (select auth.uid())
         or exists (
           select 1 from public.workspace_members wm
            where wm.workspace_id = cm.workspace_id
              and wm.user_id = (select auth.uid())
              and wm.accepted_at is not null)
       ));
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_submission(sub_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.campaign_submissions cs
      join public.campaign_applications ca on ca.id = cs.application_id
      join public.campaigns cm on cm.id = ca.campaign_id
     where cs.id = sub_id
       and (
         ca.clipper_id = (select auth.uid())
         or exists (
           select 1 from public.workspace_members wm
            where wm.workspace_id = cm.workspace_id
              and wm.user_id = (select auth.uid())
              and wm.accepted_at is not null)
       ));
$function$
;

CREATE OR REPLACE FUNCTION public.emit_notification(p_user_id uuid, p_kind text, p_title text, p_body text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid, p_subject_type text DEFAULT NULL::text, p_subject_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor_display text;
begin
  if p_user_id is null then return; end if;
  if p_actor_id is not null and p_actor_id = p_user_id then return; end if;

  if exists (
    select 1 from public.notification_preferences np
    where np.user_id = p_user_id and p_kind = any(np.muted_kinds)
  ) then
    return;
  end if;

  select full_name into actor_display from public.profiles where id = p_actor_id;

  insert into public.notifications
    (user_id, kind, title, body, url, actor_id, actor_name, subject_type, subject_id)
  values
    (p_user_id, p_kind, p_title, p_body, p_url, p_actor_id, actor_display, p_subject_type, p_subject_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.emit_workspace_notification(p_workspace_id uuid, p_kind text, p_title text, p_body text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid, p_subject_type text DEFAULT NULL::text, p_subject_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record;
begin
  if p_workspace_id is null then return; end if;
  for m in
    select wm.user_id from public.workspace_members wm
     where wm.workspace_id = p_workspace_id and wm.accepted_at is not null
  loop
    perform public.emit_notification(
      m.user_id, p_kind, p_title, p_body, p_url,
      p_actor_id, p_subject_type, p_subject_id);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_campaign_workspace_member(c_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.campaigns c
      join public.workspace_members wm on wm.workspace_id = c.workspace_id
     where c.id = c_id and wm.user_id = (select auth.uid())
       and wm.accepted_at is not null);
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws and wm.user_id = (select auth.uid())
      and wm.accepted_at is not null);
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member_or_invited(ws uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws and wm.user_id = (select auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.tg_claim_workspace_invites()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv record;
begin
  if new.email is null then return new; end if;
  for inv in
    select * from public.workspace_invites
     where lower(email) = lower(new.email) and claimed_at is null and expires_at > now()
  loop
    insert into public.workspace_members (workspace_id, user_id, role, invited_by, accepted_at)
    values (inv.workspace_id, new.id, inv.role, inv.invited_by, null)
    on conflict (workspace_id, user_id) do nothing;
    update public.workspace_invites set claimed_at = now() where id = inv.id;
  end loop;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_ensure_workspace_for_brand()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ws_id uuid;
begin
  if new.role <> 'brand' then return new; end if;
  if exists (select 1 from public.workspaces w where w.owner_id = new.id) then return new; end if;
  insert into public.workspaces (name, owner_id)
  values (coalesce(new.full_name, 'My workspace'), new.id) returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
  values (ws_id, new.id, 'owner', now());
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_guard_member_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare caller uuid;
begin
  caller := (select auth.uid());
  if caller is null then return new; end if;
  if public.workspace_role(new.workspace_id) in ('owner','admin') then return new; end if;
  if new.user_id <> caller then
    raise exception 'You can only respond to your own invitation' using errcode = 'insufficient_privilege';
  end if;
  if new.role is distinct from old.role
     or new.workspace_id is distinct from old.workspace_id
     or new.invited_by is distinct from old.invited_by then
    raise exception 'You can only accept or decline an invitation, not change its terms'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_annotation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ca record; cm record; m record;
begin
  select cs.application_id, a.clipper_id, a.campaign_id into ca
    from public.campaign_submissions cs
    join public.campaign_applications a on a.id = cs.application_id
   where cs.id = new.submission_id;
  if ca.campaign_id is null then return new; end if;
  select cmp.title, cmp.workspace_id into cm from public.campaigns cmp where cmp.id = ca.campaign_id;

  perform public.emit_notification(
    ca.clipper_id, 'annotation_added', 'New feedback on your clip',
    left(new.body, 120), '/campaigns/' || ca.campaign_id,
    new.author_id, 'annotation', new.id);

  for m in select wm.user_id from public.workspace_members wm
            where wm.workspace_id = cm.workspace_id and wm.accepted_at is not null
  loop
    perform public.emit_notification(
      m.user_id, 'annotation_added', 'New feedback on a clip',
      left(new.body, 120), '/campaigns/' || ca.campaign_id,
      new.author_id, 'annotation', new.id);
  end loop;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_application_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  select id, title, workspace_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;
  perform public.emit_workspace_notification(
    c.workspace_id, 'application_received', 'New application',
    'Someone applied to ' || c.title, '/campaigns/' || c.id,
    new.clipper_id, 'application', new.id);
  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, new.clipper_id, 'application_received', jsonb_build_object('application_id', new.id));
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_application_reviewed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('approved','rejected') then return new; end if;
  select id, title, brand_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;
  perform public.emit_notification(
    new.clipper_id, 'application_' || new.status,
    case when new.status = 'approved' then 'Application approved' else 'Application not accepted' end,
    c.title, '/dashboard', c.brand_id, 'application', new.id);
  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, c.brand_id, 'application_' || new.status, jsonb_build_object('application_id', new.id));
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_invite_answered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('accepted','declined') then return new; end if;
  select id, title, workspace_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;
  perform public.emit_workspace_notification(
    c.workspace_id, 'invite_' || new.status,
    case when new.status = 'accepted' then 'Invite accepted' else 'Invite declined' end,
    coalesce(c.title, 'A campaign'), '/campaigns/' || c.id,
    new.clipper_id, 'invite', new.id);
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_invite_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  select id, title into c from public.campaigns where id = new.campaign_id;
  perform public.emit_notification(
    new.clipper_id, 'invite_received', 'You have been invited to a campaign',
    coalesce(c.title, 'A campaign'), '/invitations',
    new.invited_by, 'invite', new.id);
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status not in ('held','released') then return new; end if;
  perform public.emit_notification(
    new.clipper_id, 'payout_' || new.status,
    case when new.status = 'held' then 'Payment held for your clip' else 'Payment released' end,
    null, '/dashboard', null, 'payout', new.id);
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_submission_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  select cm.id, cm.title, cm.workspace_id into c
    from public.campaign_applications ca
    join public.campaigns cm on cm.id = ca.campaign_id
   where ca.id = new.application_id;
  if c.id is null then return new; end if;
  perform public.emit_workspace_notification(
    c.workspace_id, 'submission_received', 'New clip submitted',
    c.title, '/campaigns/' || c.id, new.clipper_id, 'submission', new.id);
  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, new.clipper_id, 'submission_received', jsonb_build_object('submission_id', new.id));
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_on_message_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ca record; cm record; m record; preview text;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  select c.application_id, c.campaign_id into ca from public.conversations c where c.id = new.conversation_id;
  select cmp.title, cmp.workspace_id into cm from public.campaigns cmp where cmp.id = ca.campaign_id;
  preview := left(coalesce(new.body, 'Sent an attachment'), 120);

  perform public.emit_notification(
    (select clipper_id from public.campaign_applications where id = ca.application_id),
    'message_received', 'New message', preview,
    '/messages/' || new.conversation_id, new.sender_id, 'message', new.id);

  for m in select wm.user_id from public.workspace_members wm
            where wm.workspace_id = cm.workspace_id and wm.accepted_at is not null
  loop
    perform public.emit_notification(
      m.user_id, 'message_received', 'New message', preview,
      '/messages/' || new.conversation_id, new.sender_id, 'message', new.id);
  end loop;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_open_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.conversations (application_id, campaign_id)
  values (new.id, new.campaign_id) on conflict (application_id) do nothing;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_protect_last_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ws uuid; remaining int;
begin
  ws := coalesce(old.workspace_id, new.workspace_id);
  if old.role <> 'owner' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then return new; end if;
  select count(*) into remaining from public.workspace_members wm
   where wm.workspace_id = ws and wm.role = 'owner'
     and wm.accepted_at is not null and wm.user_id <> old.user_id;
  if remaining = 0 then
    raise exception 'A workspace must have at least one owner' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end; $function$
;

CREATE OR REPLACE FUNCTION public.workspace_role(ws uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select wm.role from public.workspace_members wm
   where wm.workspace_id = ws and wm.user_id = (select auth.uid())
     and wm.accepted_at is not null limit 1;
$function$
;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Avatar images are publicly accessible"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Users can update their own avatar"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'avatars'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])))
with check (((bucket_id = 'avatars'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));



  create policy "Users can upload their own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));



