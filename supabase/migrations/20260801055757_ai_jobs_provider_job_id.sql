-- Correlate an ai_job with the provider's own job id.
--
-- Slice 3.3 hands work to Sarvam's batch API, which returns its own job id. Two
-- things need to map that back to a row here, and neither can do it without a
-- column: the webhook (which carries a status and a provider job id, and
-- nothing else) and the cron poller.
--
-- It goes in a real column rather than inside `input` jsonb because the poller
-- looks jobs up by it on every tick, and because it must be written *before*
-- the audio is relayed — a relay killed mid-flight otherwise leaves a running
-- provider job with nothing on our side pointing at it.

alter table public.ai_jobs
  add column if not exists provider_job_id text;

-- Partial: only in-flight jobs are ever looked up this way, and the table grows
-- without bound.
create index if not exists ai_jobs_provider_job_idx
  on public.ai_jobs (provider_job_id)
  where provider_job_id is not null and status in ('queued','running');

comment on column public.ai_jobs.provider_job_id is
  'The provider''s own job identifier. Written before any bytes are sent, so a '
  'crashed relay is still reconcilable by the poller.';
