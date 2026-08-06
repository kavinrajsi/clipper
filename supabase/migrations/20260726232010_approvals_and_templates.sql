-- Approval workflow + campaign templates.
--
-- APPROVALS. Once a workspace has several members, "approved" is ambiguous — a
-- junior marketer approving a submission should not be able to release
-- ₹200,000. With one member the question never arose; the moment teams exist it
-- is the first blocker.

create table if not exists public.approval_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  submission_approvals_required int not null default 1
    check (submission_approvals_required between 1 and 10),
  -- Below this amount one approval is enough. Null means the rule always
  -- applies.
  approval_threshold_amount numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_type text not null check (subject_type in ('submission','payout','campaign')),
  subject_id uuid not null,
  approver_id uuid not null references auth.users(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected')),
  note text,
  created_at timestamptz not null default now(),
  -- One person cannot satisfy a two-approval rule by clicking twice.
  unique (subject_type, subject_id, approver_id)
);

create index if not exists approvals_subject_idx
  on public.approvals (subject_type, subject_id);

alter table public.approval_policies enable row level security;
alter table public.approvals         enable row level security;

drop policy if exists "Workspace members read the approval policy" on public.approval_policies;
create policy "Workspace members read the approval policy"
  on public.approval_policies for select to authenticated
  using (public.is_workspace_member(approval_policies.workspace_id));

drop policy if exists "Owners and admins set the approval policy" on public.approval_policies;
create policy "Owners and admins set the approval policy"
  on public.approval_policies for all to authenticated
  using (public.workspace_role(approval_policies.workspace_id) in ('owner','admin'))
  with check (public.workspace_role(approval_policies.workspace_id) in ('owner','admin'));

drop policy if exists "Workspace members read approvals" on public.approvals;
create policy "Workspace members read approvals"
  on public.approvals for select to authenticated
  using (public.is_workspace_member(approvals.workspace_id));

-- You approve as yourself, in a workspace you belong to. Nothing else.
drop policy if exists "Workspace members record their own approval" on public.approvals;
create policy "Workspace members record their own approval"
  on public.approvals for insert to authenticated
  with check (
    approver_id = (select auth.uid())
    and public.is_workspace_member(approvals.workspace_id)
  );

drop policy if exists "Approvers withdraw their own approval" on public.approvals;
create policy "Approvers withdraw their own approval"
  on public.approvals for delete to authenticated
  using (approver_id = (select auth.uid()));

-- Whether a subject has cleared its workspace's approval bar.
-- Read by the approve route BEFORE the Razorpay call, never client-side.
create or replace function public.has_required_approvals(
  ws uuid, p_subject_type text, p_subject_id uuid, p_amount numeric default null
) returns boolean
language sql security definer stable set search_path = public as $$
  select (
    select count(*) from public.approvals a
     where a.subject_type = p_subject_type
       and a.subject_id = p_subject_id
       and a.decision = 'approved'
  ) >= (
    select case
      when p.submission_approvals_required is null then 1
      -- Under the threshold, one approval is enough.
      when p.approval_threshold_amount is not null
       and p_amount is not null
       and p_amount < p.approval_threshold_amount then 1
      else p.submission_approvals_required
    end
    from public.approval_policies p where p.workspace_id = ws
  );
$$;

revoke all on function public.has_required_approvals(uuid,text,uuid,numeric) from public;
grant execute on function public.has_required_approvals(uuid,text,uuid,numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- TEMPLATES. Brands run the same campaign shape repeatedly and retype it every
-- time.
--
-- payload is JSONB so the template shape survives campaigns gaining columns
-- without a migration each time. It deliberately carries NO budget and NO
-- funding state — a template that pre-fills money is a mis-click waiting to
-- happen.
-- ---------------------------------------------------------------------------

create table if not exists public.campaign_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  is_platform_template boolean not null default false,
  name text not null,
  description text,
  payload jsonb not null default '{}',
  use_count int not null default 0,
  created_at timestamptz not null default now(),
  -- Platform starters have no workspace; workspace templates must have one.
  check (is_platform_template or workspace_id is not null)
);

create index if not exists campaign_templates_workspace_idx
  on public.campaign_templates (workspace_id, created_at desc);

alter table public.campaigns
  add column if not exists template_id uuid
    references public.campaign_templates(id) on delete set null;

alter table public.campaign_templates enable row level security;

-- Platform starters are readable by everyone and double as the empty state for
-- a brand's first campaign.
drop policy if exists "Templates are readable by their workspace" on public.campaign_templates;
create policy "Templates are readable by their workspace"
  on public.campaign_templates for select to authenticated
  using (
    is_platform_template
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

drop policy if exists "Workspace members manage their templates" on public.campaign_templates;
create policy "Workspace members manage their templates"
  on public.campaign_templates for all to authenticated
  using (
    is_platform_template = false
    and workspace_id is not null
    and public.is_workspace_member(workspace_id)
  )
  with check (
    is_platform_template = false
    and workspace_id is not null
    and public.is_workspace_member(workspace_id)
  );

-- Starter templates, so a brand's first campaign is not a blank form.
insert into public.campaign_templates (is_platform_template, name, description, payload)
select true, v.name, v.description, v.payload::jsonb
from (values
  ('Podcast clips',
   'Cut highlights from long-form episodes into vertical clips.',
   '{"payout_structure":"per_view","requirements":"Vertical 9:16. Burned-in subtitles. Hook in the first 2 seconds. 30-60s.","platform":"youtube"}'),
  ('Product demo cuts',
   'Short demos of a single feature, for paid social.',
   '{"payout_structure":"flat_fee","requirements":"Vertical 9:16. Show the product in the first 3 seconds. No music over voiceover. Under 45s.","platform":"youtube"}'),
  ('Launch teasers',
   'Short teasers building to a launch date.',
   '{"payout_structure":"flat_fee","requirements":"Vertical 9:16. End on the launch date card. Keep it under 20s.","platform":"youtube"}')
) as v(name, description, payload)
where not exists (
  select 1 from public.campaign_templates t
   where t.is_platform_template and t.name = v.name
);
