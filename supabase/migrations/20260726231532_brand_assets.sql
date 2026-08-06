-- Brand kit and asset library.
--
-- Creators guess at brand presentation today, so fonts, colours and logo
-- placement get re-litigated in every revision cycle — the most common
-- avoidable revision in short-form work.
--
-- brand_profiles.font_name/color_code already existed as the seed. Widened to
-- arrays, because a brand has a palette, not one hex. The old columns are kept
-- and still readable during the transition.

alter table public.brand_profiles
  add column if not exists colors jsonb not null default '[]',
  add column if not exists fonts jsonb not null default '[]',
  add column if not exists guidelines text,
  add column if not exists tone_notes text;

update public.brand_profiles
   set colors = jsonb_build_array(jsonb_build_object('hex', color_code, 'label', 'Primary'))
 where color_code is not null and colors = '[]'::jsonb;

update public.brand_profiles
   set fonts = jsonb_build_array(jsonb_build_object('name', font_name, 'role', 'Primary'))
 where font_name is not null and fonts = '[]'::jsonb;

create table if not exists public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  kind text not null check (kind in
    ('logo','font','music','sting','b_roll','template','document','other')),
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  -- Licensed fonts and music carry redistribution terms the platform cannot
  -- verify, so this is free text plus an explicit acknowledgement at upload.
  usage_rights text,
  created_at timestamptz not null default now()
);

create index if not exists brand_assets_workspace_idx
  on public.brand_assets (workspace_id, created_at desc);

alter table public.brand_assets enable row level security;

drop policy if exists "Workspace members manage brand assets" on public.brand_assets;
create policy "Workspace members manage brand assets"
  on public.brand_assets for all to authenticated
  using (public.is_workspace_member(brand_assets.workspace_id))
  with check (public.is_workspace_member(brand_assets.workspace_id));

-- Approved creators get read-only access to the kit for campaigns they are
-- actually working on — and lose it when the application is un-approved.
drop policy if exists "Approved creators read brand assets" on public.brand_assets;
create policy "Approved creators read brand assets"
  on public.brand_assets for select to authenticated
  using (
    exists (
      select 1
        from public.campaigns c
        join public.campaign_applications ca on ca.campaign_id = c.id
       where c.workspace_id = brand_assets.workspace_id
         and ca.clipper_id = (select auth.uid())
         and ca.status = 'approved'
    )
  );

-- ---------------------------------------------------------------------------
-- Storage.
--
-- A PRIVATE bucket, unlike avatars. Public URLs are fine for an avatar and
-- wrong for licensed fonts and music, so reads go through createSignedUrl.
--
-- RLS on brand_assets does NOT protect the objects — storage.objects has its
-- own policies, and forgetting that is the classic expensive mistake. The
-- policies below mirror the table exactly.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', false)
on conflict (id) do nothing;

-- Objects are keyed <workspace_id>/<filename>, so the first path segment is the
-- workspace and can be checked directly.
drop policy if exists "Workspace members read brand asset objects" on storage.objects;
create policy "Workspace members read brand asset objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'brand-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Workspace members write brand asset objects" on storage.objects;
create policy "Workspace members write brand asset objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Workspace members delete brand asset objects" on storage.objects;
create policy "Workspace members delete brand asset objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'brand-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );
