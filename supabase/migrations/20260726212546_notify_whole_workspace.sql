-- Fan brand-side notifications out to every workspace member.
--
-- The notification triggers resolved the brand recipient via campaigns.brand_id
-- — a single user. That was correct while every workspace had exactly one
-- member, but the team UI is about to make multi-member workspaces real, and a
-- notification that only reaches the original creator is worse than none: the
-- person who needs to act never learns it is their turn.
--
-- Landing this BEFORE the team UI, so the first workspace with two members is
-- already correct rather than quietly wrong.
--
-- Everyone in the workspace is notified. emit_notification already skips the
-- actor and honours per-user muted_kinds, so a member who triggered the change
-- does not hear about their own action, and anyone can opt out individually.

create or replace function public.emit_workspace_notification(
  p_workspace_id uuid, p_kind text, p_title text,
  p_body text default null, p_url text default null,
  p_actor_id uuid default null,
  p_subject_type text default null, p_subject_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m record;
begin
  if p_workspace_id is null then return; end if;

  for m in
    select wm.user_id
      from public.workspace_members wm
     where wm.workspace_id = p_workspace_id
       and wm.accepted_at is not null
  loop
    perform public.emit_notification(
      m.user_id, p_kind, p_title, p_body, p_url,
      p_actor_id, p_subject_type, p_subject_id);
  end loop;
end;
$$;

revoke all on function public.emit_workspace_notification(uuid,text,text,text,text,uuid,text,uuid) from public;

-- Application created -> tell the whole workspace.
create or replace function public.tg_notify_application_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, title, workspace_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;

  perform public.emit_workspace_notification(
    c.workspace_id, 'application_received',
    'New application',
    'Someone applied to ' || c.title,
    '/campaigns/' || c.id,
    new.clipper_id, 'application', new.id);

  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, new.clipper_id, 'application_received', jsonb_build_object('application_id', new.id));
  return new;
end; $$;

-- Invite answered -> tell the whole workspace.
create or replace function public.tg_notify_invite_answered()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('accepted','declined') then return new; end if;

  select id, title, workspace_id into c from public.campaigns where id = new.campaign_id;
  if c.id is null then return new; end if;

  perform public.emit_workspace_notification(
    c.workspace_id, 'invite_' || new.status,
    case when new.status = 'accepted' then 'Invite accepted' else 'Invite declined' end,
    coalesce(c.title, 'A campaign'),
    '/campaigns/' || c.id,
    new.clipper_id, 'invite', new.id);
  return new;
end; $$;

-- Submission created -> tell the whole workspace.
create or replace function public.tg_notify_submission_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select cm.id, cm.title, cm.workspace_id into c
    from public.campaign_applications ca
    join public.campaigns cm on cm.id = ca.campaign_id
   where ca.id = new.application_id;
  if c.id is null then return new; end if;

  perform public.emit_workspace_notification(
    c.workspace_id, 'submission_received',
    'New clip submitted',
    c.title,
    '/campaigns/' || c.id,
    new.clipper_id, 'submission', new.id);

  insert into public.activity_events (campaign_id, actor_id, kind, metadata)
  values (c.id, new.clipper_id, 'submission_received', jsonb_build_object('submission_id', new.id));
  return new;
end; $$;

-- Application reviewed and payout triggers are unchanged: both notify the
-- CLIPPER, who is one person regardless of how many members the workspace has.
