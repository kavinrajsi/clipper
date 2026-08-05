-- Notification sound, and the Realtime delivery it needs.
--
-- Until now `notifications` was written by triggers and read once per page
-- load. Nothing pushed. The bell and the sidebar badge changed only on a
-- server re-render, and there was no audio anywhere in the app.

-- ---------------------------------------------------------------------------
-- 1. Realtime
--
-- Mirrors what 20260726223336_chat.sql did for public.messages: without this
-- the subscription connects and silently receives nothing. It is the step that
-- gets forgotten.
--
-- Guarded, because `alter publication ... add table` is not idempotent and
-- `db reset` replays every migration. The chat one is unguarded and gets away
-- with it only because the table is added exactly once in the whole history.
--
-- Default replica identity is right here: the subscription is INSERT-only, and
-- `full` matters only for the old-record RLS check on UPDATE/DELETE.
--
-- RLS governs Realtime, so "Users read their own notifications"
-- (`(select auth.uid()) = user_id`) is the boundary. The channel-side
-- user_id filter is an optimisation, not the security control.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sound preference
--
-- Deliberately NOT muted_kinds. emit_notification checks muted_kinds before it
-- inserts, so a muted kind produces no row at all — muting the sound that way
-- would also take the unread badge and the notification list entry with it.
-- Delivery and presentation are different decisions.
--
-- The existing "Users manage their notification preferences" policy is
-- `for all` over the row, so it already covers this column.
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  add column if not exists sound_enabled boolean not null default true;
