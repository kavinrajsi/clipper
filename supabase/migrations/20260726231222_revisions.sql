-- Revisions and delivery tracking.
--
-- campaign_submissions was one-shot: submit a URL, get approved or rejected.
-- A rejection was terminal and unexplained, so revision cycles happened in DMs
-- and the platform lost all visibility — it could not adjudicate a dispute,
-- measure delivery quality, or tell a creator why they were rejected.
--
-- delivery_state is added ALONGSIDE status, not replacing it. status is read by
-- the approve route and the admin tables; status stays the payment-relevant
-- state, delivery_state carries the richer workflow. Consolidate later, once
-- nothing depends on the old column.

alter table public.campaign_submissions
  add column if not exists revision_number int not null default 1
    check (revision_number > 0),
  add column if not exists parent_submission_id uuid
    references public.campaign_submissions(id) on delete set null,
  add column if not exists delivery_state text not null default 'submitted'
    check (delivery_state in
      ('submitted','in_review','revision_requested','approved','rejected')),
  -- Snapshotted at submission so approval integrity survives a creator
  -- swapping the video behind the same YouTube URL.
  add column if not exists title_at_submission text,
  add column if not exists thumbnail_at_submission text;

create index if not exists campaign_submissions_parent_idx
  on public.campaign_submissions (parent_submission_id);

create table if not exists public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.campaign_submissions(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  notes text not null,
  created_at timestamptz not null default now()
);

create index if not exists revision_requests_submission_idx
  on public.revision_requests (submission_id, created_at desc);

alter table public.revision_requests enable row level security;

-- Same access rule as annotations: the submitting clipper, or an accepted
-- member of the campaign's workspace. can_access_submission is already a
-- SECURITY DEFINER helper, so no new cycle risk.
drop policy if exists "Participants read revision requests" on public.revision_requests;
create policy "Participants read revision requests"
  on public.revision_requests for select to authenticated
  using (public.can_access_submission(revision_requests.submission_id));

-- Only the workspace asks for changes; the creator answers with a new version.
drop policy if exists "Workspace requests revisions" on public.revision_requests;
create policy "Workspace requests revisions"
  on public.revision_requests for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and exists (
      select 1
        from public.campaign_submissions cs
        join public.campaign_applications ca on ca.id = cs.application_id
       where cs.id = revision_requests.submission_id
         and public.is_campaign_workspace_member(ca.campaign_id)
    )
  );

-- A revision cannot be requested once money has moved against the submission.
-- That is a dispute, not a revision.
create or replace function public.tg_guard_revision_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare paid int;
begin
  select count(*) into paid
    from public.campaign_submissions cs
    join public.campaign_payouts p on p.application_id = cs.application_id
   where cs.id = new.submission_id
     and p.status in ('held','released');

  if paid > 0 then
    raise exception 'A payout already exists for this submission — that is a dispute, not a revision'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists guard_revision_request on public.revision_requests;
create trigger guard_revision_request
  before insert on public.revision_requests
  for each row execute function public.tg_guard_revision_request();

-- Requesting a revision moves the submission and tells the creator.
create or replace function public.tg_on_revision_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare cs record;
begin
  update public.campaign_submissions
     set delivery_state = 'revision_requested', updated_at = now()
   where id = new.submission_id;

  select s.clipper_id, ca.campaign_id into cs
    from public.campaign_submissions s
    join public.campaign_applications ca on ca.id = s.application_id
   where s.id = new.submission_id;

  perform public.emit_notification(
    cs.clipper_id, 'revision_requested', 'Changes requested on your clip',
    left(new.notes, 120), '/submissions/' || new.submission_id,
    new.requested_by, 'submission', new.submission_id);

  return new;
end; $$;

drop trigger if exists on_revision_requested on public.revision_requests;
create trigger on_revision_requested
  after insert on public.revision_requests
  for each row execute function public.tg_on_revision_requested();

-- A resubmission carries the version chain forward.
create or replace function public.tg_number_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_submission_id is not null then
    select coalesce(max(revision_number), 0) + 1 into new.revision_number
      from public.campaign_submissions
     where application_id = new.application_id;

    -- Supersede the version being replaced, so only the newest is actionable.
    update public.campaign_submissions
       set delivery_state = 'rejected', updated_at = now()
     where id = new.parent_submission_id
       and delivery_state in ('submitted','in_review','revision_requested');
  end if;
  return new;
end; $$;

drop trigger if exists number_revision on public.campaign_submissions;
create trigger number_revision
  before insert on public.campaign_submissions
  for each row execute function public.tg_number_revision();
