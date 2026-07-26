-- Chat, scoped to a campaign application.
--
-- Deliberately NOT global DMs: a conversation exists only between a clipper and
-- the workspace they applied to. That is what stops cold-outreach spam, which
-- is what makes creator inboxes on other marketplaces useless.
--
-- NO conversation_participants TABLE. Access is derived — the clipper on the
-- application, plus any accepted member of the campaign's workspace. Storing
-- participants would need re-syncing every time someone joins or leaves a
-- workspace, and a missed sync is a silent access bug in either direction.
--
-- POLICY CYCLES: conversations and messages both need "can this caller see this
-- conversation", which reads campaign_applications and workspace_members —
-- whose own policies read campaigns. Routed through a SECURITY DEFINER helper,
-- per the rule in AGENTS.md.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique
    references public.campaign_applications(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create index if not exists conversations_campaign_idx
  on public.conversations (campaign_id, last_message_at desc nulls last);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text,
  attachments jsonb not null default '[]',
  -- Deep links to a submission, milestone or annotation.
  subject_type text,
  subject_id uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (body is not null or jsonb_array_length(attachments) > 0)
);

-- created_at alone is ambiguous under clock skew; id breaks the tie so ordering
-- is stable.
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- Unread counts. Separate from access, which is derived.
create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.conversation_reads  enable row level security;

-- ---------------------------------------------------------------------------
-- Access helper
-- ---------------------------------------------------------------------------

create or replace function public.can_access_conversation(conv_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
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
              and wm.accepted_at is not null
         )
       )
  );
$$;

revoke all on function public.can_access_conversation(uuid) from public;
grant execute on function public.can_access_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
--
-- These govern Realtime as well as REST. A wrong policy here does not just leak
-- a query — it broadcasts every message to every subscriber.
-- ---------------------------------------------------------------------------

drop policy if exists "Participants can read the conversation" on public.conversations;
create policy "Participants can read the conversation"
  on public.conversations for select to authenticated
  using (public.can_access_conversation(conversations.id));

drop policy if exists "Participants can read messages" on public.messages;
create policy "Participants can read messages"
  on public.messages for select to authenticated
  using (public.can_access_conversation(messages.conversation_id));

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.can_access_conversation(messages.conversation_id)
  );

-- Own messages only, and soft-delete so the audit trail survives a dispute.
drop policy if exists "Senders can edit their own messages" on public.messages;
create policy "Senders can edit their own messages"
  on public.messages for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));

drop policy if exists "Users manage their own read state" on public.conversation_reads;
create policy "Users manage their own read state"
  on public.conversation_reads for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- A conversation opens as soon as someone applies.
--
-- On application, not on approval: that is exactly when questions matter most,
-- and the brand deciding whether to approve is the reason to talk.
-- ---------------------------------------------------------------------------

create or replace function public.tg_open_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversations (application_id, campaign_id)
  values (new.id, new.campaign_id)
  on conflict (application_id) do nothing;
  return new;
end; $$;

drop trigger if exists open_conversation on public.campaign_applications;
create trigger open_conversation
  after insert on public.campaign_applications
  for each row execute function public.tg_open_conversation();

-- Backfill for applications that predate chat.
insert into public.conversations (application_id, campaign_id)
select ca.id, ca.campaign_id from public.campaign_applications ca
 where not exists (select 1 from public.conversations c where c.application_id = ca.id);

-- ---------------------------------------------------------------------------
-- Bump last_message_at, and notify everyone in the conversation except the
-- sender. Reuses emit_notification, so muting and self-exclusion still apply.
-- ---------------------------------------------------------------------------

create or replace function public.tg_on_message_sent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ca record;
  cm record;
  m  record;
  preview text;
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;

  select c.application_id, c.campaign_id into ca
    from public.conversations c where c.id = new.conversation_id;

  select cmp.title, cmp.workspace_id into cm
    from public.campaigns cmp where cmp.id = ca.campaign_id;

  preview := left(coalesce(new.body, 'Sent an attachment'), 120);

  -- the clipper
  perform public.emit_notification(
    (select clipper_id from public.campaign_applications where id = ca.application_id),
    'message_received', 'New message', preview,
    '/messages/' || new.conversation_id, new.sender_id, 'message', new.id);

  -- every accepted workspace member
  for m in
    select wm.user_id from public.workspace_members wm
     where wm.workspace_id = cm.workspace_id and wm.accepted_at is not null
  loop
    perform public.emit_notification(
      m.user_id, 'message_received', 'New message', preview,
      '/messages/' || new.conversation_id, new.sender_id, 'message', new.id);
  end loop;

  return new;
end; $$;

drop trigger if exists on_message_sent on public.messages;
create trigger on_message_sent
  after insert on public.messages
  for each row execute function public.tg_on_message_sent();

-- ---------------------------------------------------------------------------
-- Realtime.
--
-- Without this the subscription connects and silently receives nothing. It is
-- the step that gets forgotten.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;
