# Collaboration

**Phase 1:** notifications, activity feed.
**Phase 2:** chat, comments, video annotations, timeline feedback.

The phase where the already-vendored dead code pays for itself.

## Reuse triage

| Already built | Extend this | Genuinely new |
|---|---|---|
| **`ui/message.jsx`, `ui/bubble.jsx`, `ui/message-scroller.jsx`, `ui/attachment.jsx`, `ui/marker.jsx`** — a complete shadcn chat kit, fully implemented, **imported by nothing** | Use as-is | — |
| `@shadcn/react` dependency — installed, sole consumer is the dead `message-scroller.jsx`. Provides `useMessageScroller`, stick-to-bottom scroll behaviour | Use as-is | — |
| **Supabase Realtime** — ships inside `@supabase/supabase-js`, **zero `.channel()` calls anywhere** | Enable publication on new tables; write the client plumbing | Subscription hook + context |
| `<Toaster/>` mounted at `src/app/(protected)/layout.js:5` — **`toast()` never called anywhere** | Start calling it | — |
| `ActivityFeed` (`src/components/activity-feed.jsx`) — renders YouTube activity with a `TYPE_ICON` map | Generalise to platform-wide events; swap hand-rolled rows for `ui/item.jsx` | `activity_events` |
| `youtube_activities` | Precedent for the event-row shape | `notifications` |
| `ui/item.jsx`, `ui/empty.jsx`, `ui/badge.jsx` | Use as-is | — |
| — | — | `conversations`, `messages`, `annotations` |

**Chat requires zero new dependencies.** The UI kit is written, the scroll behaviour is solved, the realtime client is installed. What's missing is tables, policies, and roughly 200 lines of subscription plumbing.

---

## 1. Notifications

**Phase 1.** The cheapest high-impact feature in the roadmap.

### Problem

Nothing tells anyone anything. A creator whose application is approved finds out by re-opening the dashboard and noticing a badge changed. A brand whose creator submitted a clip finds out the same way. There is no email, no in-app notification, no toast — the `<Toaster/>` is mounted and has never been called.

The cost is invisible but large: every workflow in the product has a silent handoff, and the party waiting has no idea it's their turn. Time-to-first-response is the metric that determines whether a marketplace feels alive, and right now it's bounded by how often people happen to check.

### User flow

```
Any state change with a counterparty
  → notification row written in the same transaction
  → in-app: bell badge + dropdown (realtime once Phase 2 lands, polled before that)
  → toast if the user is on-screen
  → email if unread after N minutes and the user's preferences allow
```

Deliberately: **the notification is created by the same code that changes the state**, not by a separate listener. Getting a notification that doesn't correspond to a real state change is worse than none.

### UI screens

Bell icon in `site-header.jsx` with an unread count. Dropdown grouped by today / earlier, each row using `ui/item.jsx`, unread visually distinct, "mark all read." A full `/notifications` page for history. Preferences on `/profile`: per-category toggles for in-app and email.

Toasts fire only for events caused by someone else while you're looking. Toasting your own action is noise.

### Database schema

```sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  actor_id uuid references auth.users(id) on delete set null,
  subject_type text,
  subject_id uuid,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app jsonb not null default '{}',
  email jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
```

The partial index is the one that matters — the unread-count query runs on every page load.

Initial `kind` values, one per existing state transition:

`application_received`, `application_approved`, `application_rejected`, `invite_received`, `submission_received`, `revision_requested`, `submission_approved`, `payout_held`, `payout_released`, `payout_failed`, `campaign_funded`, `campaign_cancelled`, `review_received`, `message_received`

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/notifications` | `GET` | Paginated list + unread count |
| `/api/notifications/read` | `POST` | Mark one or all read |
| `/api/notifications/preferences` | `PATCH` | Update preferences |

Writes happen server-side inside existing routes. Extract `notify(userId, kind, payload)` into `src/lib/notifications.js` and call it from the approve, release, apply, and invite routes — one helper, many call sites, rather than notification logic scattered through payment code.

### Permissions

Pattern 1, owner-only — a user reads and updates only their own notifications. No insert policy for clients at all; notifications are written server-side via the admin client, exactly like `campaign_payouts`. That prevents a user fabricating a notification to phish another.

### Edge cases

- **Notification without state change**, or vice versa. Write both in one transaction. If the notification insert fails, the state change should still commit — degrade to silent rather than blocking a payment.
- **Self-notification** — the actor should never be notified of their own action. Check `actor_id <> user_id` at write time.
- **Email requires a provider that doesn't exist.** No `resend`, `nodemailer`, or `@sendgrid/mail` is installed; the only mail sent today is Supabase Auth's. Phase 1 ships in-app only; email is a scoped follow-on with its own dependency decision.
- **Notification storms** — a campaign with 50 applicants shouldn't produce 50 rows for the brand. Digest by kind within a time window.
- **Unbounded growth** — retention policy, archive or delete read notifications past 90 days.
- **Deep links to deleted subjects** must land on a graceful "no longer available," not a 500.

### AI opportunities

Priority scoring so the important notification surfaces first; digest summarisation ("3 new applications, 1 from a creator you've hired before"); send-time optimisation per user.

### Future improvements

Web push; Slack and Discord integrations for brand teams; per-workspace routing rules; quiet hours.

---

## 2. Activity feed

**Phase 1.**

### Problem

`ActivityFeed` exists but only renders synced YouTube activity for the creator viewing it. There's no campaign-level history: who applied when, when it was approved, when money moved. When something goes wrong, nobody can reconstruct what happened — including support and `/admin`.

### Schema & approach

```sql
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index activity_events_campaign_idx
  on public.activity_events (campaign_id, created_at desc);
```

Append-only. No update or delete policy for anyone, including admin — that's what makes it usable as an audit trail during a payment dispute.

`ActivityFeed` generalises: it already maps event types to lucide icons via `TYPE_ICON`, which extends directly. Swap its hand-rolled rows for the unused `ui/item.jsx` while you're in there.

### Permissions & edge cases

Readable by workspace members for their campaigns (pattern 2), and by the creator for campaigns they're engaged on — with actor identity redacted where they shouldn't see internal team activity. A creator does not need to know which team member reviewed them.

Watch: high-volume campaigns need pagination, not a full render; events referencing deleted users keep a denormalised display name; the feed must not become a second source of truth — it records what happened, it never drives behaviour.

---

## 3. Chat

**Phase 2.**

### Problem

There is no messaging. A brand and creator who need to discuss anything — and they always do — exchange emails or Instagram DMs. Consequences: the platform can't adjudicate disputes because it can't see what was agreed; deals move off-platform and so does the take rate; and response time, the single best predictor of a completed hire, is unmeasurable.

### User flow

```
Conversation opens automatically on application (brand ↔ creator, scoped to that campaign)
  → both can message; realtime delivery; typing and read receipts
  → attachments via ui/attachment.jsx
  → deep links to submissions, milestones, annotations
  → unread count in nav; notification if the recipient is away
```

Conversations are **scoped to an engagement**, not global DMs. That prevents cold-outreach spam, which is what makes creator inboxes on other marketplaces useless.

### UI screens

`/messages` — two-pane, list left and thread right, collapsing to single-pane on mobile via the existing `useIsMobile()` hook (currently used only by `ui/sidebar.jsx`).

The thread is built entirely from vendored, currently-dead components: `MessageScroller` for stick-to-bottom, `Message` and `Bubble` for rows, `Attachment` for files, `Marker` for date separators and unread dividers. This is a genuinely small build because someone already vendored the hard parts.

An inline thread also appears on the campaign detail page, scoped to that application.

### Database schema

```sql
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  application_id uuid references public.campaign_applications(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (application_id)
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text,
  attachments jsonb default '[]',
  subject_type text,
  subject_id uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index messages_conversation_idx
  on public.messages (conversation_id, created_at desc);

alter publication supabase_realtime add table public.messages;
```

That last line is the one people forget. Realtime does nothing without the table in the publication.

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/conversations` | `GET` | List with unread counts |
| `/api/conversations/[id]/messages` | `GET` / `POST` | History, send |
| `/api/conversations/[id]/read` | `POST` | Advance `last_read_at` |

Sending goes through a route handler, not a direct client insert, because it also updates `last_message_at`, fires a notification, and will eventually run moderation. Receiving is a Realtime subscription straight to the client — no polling.

**This needs the first client-side subscription plumbing in the codebase.** There is no hooks layer, no context layer, no query layer; a `useRealtimeChannel` hook in `src/hooks/` sets the convention for everything realtime that follows. Worth designing deliberately rather than inlining a `useEffect` in the chat component.

### Permissions

Participants only, pattern 2 via `conversation_participants`:

```sql
create policy "Participants can read messages"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = (select auth.uid())
    )
  );
```

RLS applies to Realtime as well as REST — a correct policy secures both. Getting this wrong broadcasts every message to every subscriber, which is the classic Realtime security failure.

Editing and deleting: own messages only, within a short window, soft-delete via `deleted_at` so the audit trail survives. Super admin reads for dispute resolution — logged, not silent.

### Edge cases

- **Off-platform leakage.** Creators and brands will try to exchange contact details to avoid the fee. Detect and warn rather than hard-block — aggressive blocking drives people off faster than the fee does.
- **Conversation before approval.** Allow it on application; that's exactly when questions matter most.
- **Blocked/reported users** need mute and report from the outset, not retrofitted.
- **Attachment abuse** — size caps, MIME allowlist, virus scanning for anything a brand will download.
- **Realtime reconnection** must backfill missed messages on resubscribe, or a flaky connection silently drops messages.
- **Optimistic send** needs a failure path — a message that appears sent but wasn't is the worst possible bug in a chat product.
- **Ordering** by `created_at` is ambiguous under clock skew; include a tiebreaker.

### AI opportunities

Draft replies from campaign context; auto-summarise a long thread into agreed terms when a dispute opens; translate cross-border conversations inline; detect scope creep in messages and prompt a milestone.

### Future improvements

Group threads once workspace teams exist; voice notes; scheduled messages across timezones; canned responses; a chat-native "send an offer" action.

---

## 4. Video annotations & timeline feedback

**Phase 2.** The feature most likely to be the reason someone chooses Clipper.

### Problem

Feedback on video is given in prose: "the intro drags and the text is too small at the end." The creator then hunts for what "the intro" means and guesses at "the end." Every revision cycle burns a round-trip on ambiguity.

Frame-accurate, timestamped comments collapse that. This is standard in Frame.io and completely absent from every freelance marketplace — Upwork and Fiverr have no concept of video review at all. It is the clearest place where Clipper being video-native beats a generalist marketplace.

### User flow

```
Brand opens a submission → player with a comment rail
  → scrub to 0:04, click "Comment here"
  → optionally draw a box on the frame
  → "hook lands too late — start on this line"
  → creator sees a timestamped list, clicks one, player jumps to that frame
  → resolve individually; unresolved count gates the revision request
```

### UI screens

Player with a marker track — `ui/marker.jsx` is vendored and unused, and is exactly this component. Comment rail beside the player, sorted by timestamp, each row showing time, author, text, resolved state. Clicking seeks. Optional bounding box overlay for spatial notes.

The player itself is the one genuinely new UI primitive in Phase 2. Everything else composes from what's already there.

### Database schema

```sql
create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.campaign_submissions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric,
  region jsonb,
  body text not null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  parent_id uuid references public.annotations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index annotations_submission_idx
  on public.annotations (submission_id, start_seconds);
```

`parent_id` gives threaded replies on a single note. `region` holds normalised 0–1 coordinates so the box survives any playback size.

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/submissions/[id]/annotations` | `GET` / `POST` | List, create |
| `/api/annotations/[id]` | `PATCH` / `DELETE` | Edit, resolve, delete |

### Permissions

Pattern 2 — the campaign's workspace members and the submission's creator. Anyone with access may resolve; `resolved_by` records who. Creators can annotate too, which matters: it's how they respond "fixed in v2" against the exact note.

### Edge cases

- **Annotations across revisions.** A note at 0:04 on v1 is meaningless on v2 where the cut changed. Annotations bind to a specific submission version and carry forward as read-only history rather than migrating timestamps.
- **YouTube-hosted videos** can't be scrubbed frame-accurately through an iframe with arbitrary overlay control. Either accept the IFrame Player API's precision limits, or require a direct upload for review — which pulls storage forward from Phase 3. **This is a real architectural decision and should be settled before the phase starts.**
- Annotations past the video duration (after a re-edit) clamp to the end rather than vanishing.
- Deleting a parent must not orphan replies — `on delete cascade` handles it.
- Very dense annotation tracks need clustering at low zoom.

### AI opportunities

Auto-generate annotations from the quality checks in [`03-ai.md`](./03-ai.md) — audio, subtitle sync, safe areas, pacing — so mechanical problems are flagged before a human watches. Cluster repeated notes across a creator's history into coaching. Summarise all unresolved notes into one revision brief.

### Future improvements

Drawing and arrow tools; voice-note annotations; side-by-side version compare with synced playback; approval directly from the annotation rail.
