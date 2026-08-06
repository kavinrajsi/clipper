-- Source assets: the long-form content a brand uploads, before anything is cut
-- from it. Phase 3, slice 2.
--
-- This is the first table in the project whose rows are written by BOTH the
-- user and a background pipeline, and the split matters. The brand owns the
-- file and its name; the pipeline owns status, transcript and duration. RLS
-- cannot restrict columns, so a trigger does it -- the same device
-- workspace_members already uses to stop an invitee editing their own role.

create table if not exists public.source_assets (
  id uuid primary key default gen_random_uuid(),

  -- Not null, unlike ai_jobs.workspace_id. Source assets are brand content:
  -- a clipper never uploads one, so there is no owner-without-workspace case
  -- here and the single membership policy below is enough.
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,

  -- Path inside the source-assets bucket. First segment is the workspace id,
  -- which is what the storage.objects policies key on.
  storage_path text not null unique,
  filename text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),

  status text not null default 'uploaded' check (status in
    ('uploaded','transcribing','analysing','ready','failed')),
  -- Populated by the transcription job in slice 3. Kept even after the media
  -- itself is deleted: 03-ai.md proposes retaining the transcript and derived
  -- metadata long after the source file goes, because that is what the
  -- suggestion-to-outcome feedback loop actually needs.
  transcript jsonb,
  error text,

  created_at timestamptz not null default now()
);

create index if not exists source_assets_workspace_idx
  on public.source_assets (workspace_id, created_at desc);

create index if not exists source_assets_pending_idx
  on public.source_assets (status, created_at)
  where status in ('uploaded','transcribing','analysing');

alter table public.source_assets enable row level security;

drop policy if exists "Workspace members read source assets" on public.source_assets;
create policy "Workspace members read source assets"
  on public.source_assets for select to authenticated
  using (public.is_workspace_member(source_assets.workspace_id));

-- A member may register an upload, but only in the state an upload can
-- legitimately start in. Without the WITH CHECK a client could insert a row
-- that claims to be `ready` with a transcript it wrote itself, and every
-- downstream job would trust it.
drop policy if exists "Workspace members register source assets" on public.source_assets;
create policy "Workspace members register source assets"
  on public.source_assets for insert to authenticated
  with check (
    public.is_workspace_member(source_assets.workspace_id)
    and status = 'uploaded'
    and transcript is null
    and duration_seconds is null
  );

drop policy if exists "Workspace members rename source assets" on public.source_assets;
create policy "Workspace members rename source assets"
  on public.source_assets for update to authenticated
  using (public.is_workspace_member(source_assets.workspace_id))
  with check (public.is_workspace_member(source_assets.workspace_id));

drop policy if exists "Workspace members delete source assets" on public.source_assets;
create policy "Workspace members delete source assets"
  on public.source_assets for delete to authenticated
  using (public.is_workspace_member(source_assets.workspace_id));

-- The update policy above deliberately lets the whole row through, because a
-- policy cannot say "every column except these five". This trigger says it.
--
-- auth.uid() is null for the service-role client and for anything running
-- outside a request, which is exactly the pipeline -- so the pipeline passes
-- and a signed-in user does not.
create or replace function public.tg_guard_source_asset_pipeline_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.transcript is distinct from old.transcript
     or new.duration_seconds is distinct from old.duration_seconds
     or new.storage_path is distinct from old.storage_path
     or new.workspace_id is distinct from old.workspace_id then
    raise exception
      'Only the processing pipeline can change a source asset''s status, transcript, duration, path or workspace'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function public.tg_guard_source_asset_pipeline_columns() from public;

drop trigger if exists guard_source_asset_pipeline_columns on public.source_assets;
create trigger guard_source_asset_pipeline_columns
  before update on public.source_assets
  for each row execute function public.tg_guard_source_asset_pipeline_columns();

-- The bucket. Private, and with a size limit far above the 50MiB default,
-- because the whole point is a 90-minute podcast.
--
-- NOTE: the hosted project has its own global upload limit, and the local stack
-- has `file_size_limit` in supabase/config.toml. A per-bucket limit cannot
-- exceed the global one, so both have to be raised for a large upload to work.
insert into storage.buckets (id, name, public, file_size_limit)
values ('source-assets', 'source-assets', false, 5368709120)  -- 5 GiB
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- RLS on source_assets does NOT protect the objects -- storage.objects has its
-- own policies. Same shape as brand-assets: the first path segment is the
-- workspace id, and that is what makes these work.
drop policy if exists "Workspace members read source asset objects" on storage.objects;
create policy "Workspace members read source asset objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'source-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Workspace members write source asset objects" on storage.objects;
create policy "Workspace members write source asset objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'source-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Workspace members delete source asset objects" on storage.objects;
create policy "Workspace members delete source asset objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'source-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );
