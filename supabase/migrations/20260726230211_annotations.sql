-- Timestamped feedback on a submission.
--
-- Feedback today is prose — "the intro drags and the text is too small at the
-- end" — and the creator then hunts for what "the intro" means. Every revision
-- cycle burns a round-trip on ambiguity. This is the clearest place where being
-- video-native beats a generalist marketplace: Upwork and Fiverr have no
-- concept of video review at all.
--
-- NO SPATIAL REGIONS. Submissions are YouTube URLs, and you cannot overlay a
-- drawing surface on a cross-origin iframe. The IFrame Player API gives
-- seekTo/getCurrentTime, which delivers the actual value ("jump to 0:04").
-- A region column is deliberately omitted rather than shipped unused — it would
-- need direct video upload, which is Phase 3 storage work.

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.campaign_submissions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  -- Seconds into the clip. end_seconds is optional: most notes are a point,
  -- some are a range.
  start_seconds numeric not null check (start_seconds >= 0),
  end_seconds numeric check (end_seconds is null or end_seconds >= start_seconds),
  body text not null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  -- Threaded replies on a single note, so "fixed in v2" attaches to the note
  -- it answers.
  parent_id uuid references public.annotations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists annotations_submission_idx
  on public.annotations (submission_id, start_seconds);

alter table public.annotations enable row level security;

-- ---------------------------------------------------------------------------
-- Access helper.
--
-- Same rule as chat: the clipper who submitted, or an accepted member of the
-- campaign's workspace. Routed through SECURITY DEFINER per the rule in
-- AGENTS.md — campaign_submissions' policies already read
-- campaign_applications and campaigns, and an inline join here risks a cycle.
-- ---------------------------------------------------------------------------

create or replace function public.can_access_submission(sub_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
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
              and wm.accepted_at is not null
         )
       )
  );
$$;

revoke all on function public.can_access_submission(uuid) from public;
grant execute on function public.can_access_submission(uuid) to authenticated;

drop policy if exists "Participants read annotations" on public.annotations;
create policy "Participants read annotations"
  on public.annotations for select to authenticated
  using (public.can_access_submission(annotations.submission_id));

-- Creators annotate too — it is how they reply "fixed in v2" against the exact
-- note, rather than in a separate message.
drop policy if exists "Participants write annotations" on public.annotations;
create policy "Participants write annotations"
  on public.annotations for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_access_submission(annotations.submission_id)
  );

-- Anyone with access may resolve; resolved_by records who. Editing the body is
-- restricted to its author.
drop policy if exists "Participants update annotations" on public.annotations;
create policy "Participants update annotations"
  on public.annotations for update to authenticated
  using (public.can_access_submission(annotations.submission_id))
  with check (public.can_access_submission(annotations.submission_id));

drop policy if exists "Authors delete their own annotations" on public.annotations;
create policy "Authors delete their own annotations"
  on public.annotations for delete to authenticated
  using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Notify the other side when a note lands.
-- ---------------------------------------------------------------------------

create or replace function public.tg_notify_annotation()
returns trigger language plpgsql security definer set search_path = public as $$
declare ca record; cm record; m record;
begin
  select cs.application_id, a.clipper_id, a.campaign_id into ca
    from public.campaign_submissions cs
    join public.campaign_applications a on a.id = cs.application_id
   where cs.id = new.submission_id;
  if ca.campaign_id is null then return new; end if;

  select cmp.title, cmp.workspace_id into cm
    from public.campaigns cmp where cmp.id = ca.campaign_id;

  perform public.emit_notification(
    ca.clipper_id, 'annotation_added', 'New feedback on your clip',
    left(new.body, 120), '/campaigns/' || ca.campaign_id,
    new.author_id, 'annotation', new.id);

  for m in
    select wm.user_id from public.workspace_members wm
     where wm.workspace_id = cm.workspace_id and wm.accepted_at is not null
  loop
    perform public.emit_notification(
      m.user_id, 'annotation_added', 'New feedback on a clip',
      left(new.body, 120), '/campaigns/' || ca.campaign_id,
      new.author_id, 'annotation', new.id);
  end loop;

  return new;
end; $$;

drop trigger if exists notify_annotation on public.annotations;
create trigger notify_annotation
  after insert on public.annotations
  for each row execute function public.tg_notify_annotation();
