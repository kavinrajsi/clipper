-- Fix the "Clippers can view campaigns they applied to" policy on public.campaigns.
--
-- The original (20260725075602_remote_schema.sql:601) had a self-referential
-- predicate:
--
--     WHERE a.campaign_id = a.id AND a.clipper_id = auth.uid()
--
-- It compares campaign_applications.campaign_id to campaign_applications.id
-- rather than to campaigns.id, so it never matches a row and the policy has
-- always been dead. Clippers relying on it could not read campaigns they had
-- applied to; only the separate "funded active campaigns" policy worked.

drop policy if exists "Clippers can view campaigns they applied to" on public.campaigns;

create policy "Clippers can view campaigns they applied to"
  on public.campaigns
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.campaign_applications a
      where a.campaign_id = campaigns.id
        and a.clipper_id = (select auth.uid())
    )
  );

-- Supports the exists() lookup above, which now runs on every campaign select
-- for an authenticated clipper.
create index if not exists campaign_applications_clipper_campaign_idx
  on public.campaign_applications (clipper_id, campaign_id);
