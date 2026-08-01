-- The AI job spine, plus per-workspace brand voice. Phase 3, slice 1.
--
-- ai_jobs is built first and on its own because it is the queue: there is no
-- job runner in this project, no cron, and AI work cannot run inside a request.
-- Every later AI feature enqueues a row here and a webhook completes it, so the
-- table has to be right before anything depends on it.
--
-- docs/product/03-ai.md sketches both tables but specifies NO RLS for either.
-- That is a gap, not a decision — both are workspace-scoped and one of them
-- records what a workspace will be billed. The policies below follow the three
-- patterns already in use (see AGENTS.md); nothing new is invented here.

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),

  -- Nullable on purpose, and this is the one place the spec sketch needs
  -- reading carefully. Not every AI job belongs to a brand workspace: the
  -- quality score and the editing suggestions run for a *clipper*, before a
  -- brand ever sees the clip, and clippers do not own workspaces. user_id is
  -- therefore the only owner every job is guaranteed to have — hence the two
  -- separate read policies below. A single is_workspace_member() policy would
  -- have made a clipper's own job invisible to the clipper, because
  -- is_workspace_member(null) is false.
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in (
    'transcribe','highlight_detect','viral_score','hook','caption',
    'subtitle','thumbnail','quality_score','edit_suggestions','hashtags')),

  -- What the job is about. Left as a loose (type, id) pair rather than ten
  -- nullable foreign keys, because the subject tables arrive across the next
  -- four slices and half of them do not exist yet.
  subject_type text check (subject_type in
    ('source_asset','highlight_candidate','submission','campaign')),
  subject_id uuid,

  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),

  input jsonb,
  output jsonb,
  model text,
  tokens_used int check (tokens_used is null or tokens_used >= 0),

  -- Recorded from slice 1 so the history exists, but nothing enforces a balance
  -- yet: the ledger that would spend it (ai_credit_ledger) needs
  -- plan_entitlements, which is Phase 4. Charging happens on success only --
  -- see docs/product/03-ai.md, "who pays for a failed job".
  credits_charged numeric not null default 0 check (credits_charged >= 0),

  error text,

  created_at timestamptz not null default now(),
  -- Not in the sketch. A queue needs to distinguish "waiting" from "running for
  -- forty minutes and probably dead", and nothing else in the row can say that.
  started_at timestamptz,
  completed_at timestamptz,

  -- A subject is both halves or neither.
  constraint ai_jobs_subject_paired
    check ((subject_type is null) = (subject_id is null)),

  -- Terminal states carry a completion time and non-terminal ones do not. This
  -- is what stops a "succeeded" row with no completed_at, which would look
  -- permanently in-flight to any poller reading the queue.
  constraint ai_jobs_completed_at_matches_status
    check ((status in ('succeeded','failed','cancelled')) = (completed_at is not null))
);

create index if not exists ai_jobs_workspace_idx
  on public.ai_jobs (workspace_id, created_at desc)
  where workspace_id is not null;

create index if not exists ai_jobs_user_idx
  on public.ai_jobs (user_id, created_at desc);

-- The queue read. Partial, because the runnable set stays small while the table
-- grows without limit.
create index if not exists ai_jobs_pending_idx
  on public.ai_jobs (status, created_at)
  where status in ('queued','running');

create index if not exists ai_jobs_subject_idx
  on public.ai_jobs (subject_type, subject_id)
  where subject_id is not null;

alter table public.ai_jobs enable row level security;

-- Two read policies, because a job has two possible owners and only one of them
-- is guaranteed. Policies are OR-ed, so a workspace job created by a member is
-- readable both ways, and a clipper's workspace-less job is still readable by
-- the clipper.
drop policy if exists "Users read their own AI jobs" on public.ai_jobs;
create policy "Users read their own AI jobs"
  on public.ai_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Workspace members read the workspace's AI jobs" on public.ai_jobs;
create policy "Workspace members read the workspace's AI jobs"
  on public.ai_jobs for select to authenticated
  using (
    workspace_id is not null
    and public.is_workspace_member(workspace_id)
  );

-- No insert, update or delete policy exists, deliberately -- the same rule as
-- campaign_payouts. status, model, tokens_used and credits_charged are the
-- provider's account of what happened and what it cost; a client that can write
-- them can mark its own job succeeded for free. Every write goes through
-- src/lib/ai/jobs.js on the service-role client, after the calling route has
-- checked authorisation on the RLS-scoped client first.

-- Per-workspace voice: tone, audience, banned terms. Conditions every generated
-- caption, hook and hashtag. brand_profiles.font_name/color_code already seed
-- the visual half of this; nothing held the verbal half.
create table if not exists public.brand_voice (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  tone text,
  audience text,
  banned_terms text[] not null default '{}',
  -- The hook for the regulated-claims problem in 03-ai.md: health, finance and
  -- supplement copy can generate claims that create real liability. Storing the
  -- disclosures is the easy half; the review policy still needs writing.
  required_disclosures text[] not null default '{}',
  emoji_policy text check (emoji_policy in ('none','sparing','liberal')),
  sample_captions text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.brand_voice enable row level security;

-- Workspace-only for now. Approved creators can read brand_assets, and an
-- argument exists for letting them read banned_terms and required_disclosures
-- too, since those constrain what they may write. Deliberately not doing it in
-- this slice: nothing generates copy yet, and the rest of the row (tone,
-- audience, sample captions) is positioning a brand may not want shared.
-- Revisit when caption generation lands in 3.6.
drop policy if exists "Workspace members manage brand voice" on public.brand_voice;
create policy "Workspace members manage brand voice"
  on public.brand_voice for all to authenticated
  using (public.is_workspace_member(brand_voice.workspace_id))
  with check (public.is_workspace_member(brand_voice.workspace_id));
