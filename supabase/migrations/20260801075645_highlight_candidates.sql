-- AI-detected highlight candidates. Phase 3, slice 4.
--
-- The moments a model proposes from a transcript. The brand picks a few; slice
-- 5 turns the picked ones into a campaign brief. This is the table that makes
-- the roadmap's inversion real -- the brand answers a few yes/no questions
-- about their own content instead of writing a brief into a void.
--
-- Ownership splits the same way source_assets does, and for the same reason:
-- the model proposes, the human decides. The pipeline writes the candidate and
-- its scores; a member may only flip `selected`. A trigger enforces that,
-- because RLS cannot restrict columns.

create table if not exists public.highlight_candidates (
  id uuid primary key default gen_random_uuid(),
  source_asset_id uuid not null references public.source_assets(id) on delete cascade,

  start_seconds numeric not null check (start_seconds >= 0),
  end_seconds numeric not null check (end_seconds >= 0),

  title text,
  -- Why the model thinks this moment stands alone. Shown to the brand when
  -- picking, and carried into the generated brief so the creator gets the
  -- reasoning too, not just a timestamp.
  rationale text,
  -- The exact words, so a brief can quote the hook line without re-reading the
  -- transcript.
  quote text,

  -- Nullable and unwritten for now. 03-ai.md is explicit that a confidently
  -- wrong score is worse than no score, and there is no delivered-performance
  -- history to calibrate against yet. The columns exist so slice 8 needs no
  -- migration; nothing writes them until there is evidence they mean anything.
  viral_score int check (viral_score is null or viral_score between 0 and 100),
  score_confidence numeric check (score_confidence is null or score_confidence between 0 and 1),

  selected boolean not null default false,
  -- Set when a picked candidate becomes a campaign. `on delete set null` so
  -- deleting a campaign does not destroy the analysis that produced it.
  campaign_id uuid references public.campaigns(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint highlight_candidates_ordered check (end_seconds > start_seconds)
);

create index if not exists highlight_candidates_asset_idx
  on public.highlight_candidates (source_asset_id, start_seconds);

create index if not exists highlight_candidates_selected_idx
  on public.highlight_candidates (source_asset_id)
  where selected;

alter table public.highlight_candidates enable row level security;

-- Scoped through the parent asset. No cycle: source_assets' own policies reach
-- workspaces via the is_workspace_member definer helper and never read this
-- table, so the rule in AGENTS.md holds without adding a new helper.
drop policy if exists "Workspace members read highlight candidates" on public.highlight_candidates;
create policy "Workspace members read highlight candidates"
  on public.highlight_candidates for select to authenticated
  using (
    exists (
      select 1 from public.source_assets sa
       where sa.id = highlight_candidates.source_asset_id
         and public.is_workspace_member(sa.workspace_id)
    )
  );

-- Picking is the entire point of the surface, so members may update. Which
-- columns they may actually change is the trigger's job, below.
drop policy if exists "Workspace members pick highlight candidates" on public.highlight_candidates;
create policy "Workspace members pick highlight candidates"
  on public.highlight_candidates for update to authenticated
  using (
    exists (
      select 1 from public.source_assets sa
       where sa.id = highlight_candidates.source_asset_id
         and public.is_workspace_member(sa.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.source_assets sa
       where sa.id = highlight_candidates.source_asset_id
         and public.is_workspace_member(sa.workspace_id)
    )
  );

-- No insert and no delete policy: candidates are the model's output, and a
-- client that could write them could hand slice 5 a brief for a moment that
-- never happens in the recording. Deletion is by cascade from the asset.

create or replace function public.tg_guard_highlight_candidate_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service-role client, which is the pipeline.
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.source_asset_id is distinct from old.source_asset_id
     or new.start_seconds is distinct from old.start_seconds
     or new.end_seconds is distinct from old.end_seconds
     or new.title is distinct from old.title
     or new.rationale is distinct from old.rationale
     or new.quote is distinct from old.quote
     or new.viral_score is distinct from old.viral_score
     or new.score_confidence is distinct from old.score_confidence then
    raise exception
      'Only the AI pipeline can change a highlight candidate; you can select or deselect it'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_guard_highlight_candidate_columns()
  from public, anon, authenticated;

drop trigger if exists guard_highlight_candidate_columns on public.highlight_candidates;
create trigger guard_highlight_candidate_columns
  before update on public.highlight_candidates
  for each row execute function public.tg_guard_highlight_candidate_columns();
