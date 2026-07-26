# Publishing

**Phase 4.** Condensed spec. Multi-platform connections (YouTube, Instagram, TikTok, LinkedIn, X, Facebook), scheduling, auto-publish.

## Reuse triage

| Already built | Extend this | Genuinely new |
|---|---|---|
| `youtube_connections` — OAuth tokens, refresh, channel metadata, verification tiers, `payout_multiplier` | The generalisation target — see the open decision below | `social_connections` |
| `src/lib/youtube.js` — `getGoogleAuthUrl`, `exchangeCodeForTokens`, `refreshAccessToken`, `googleGet` | The provider-adapter shape to copy per platform | `src/lib/platforms/*.js` |
| `/api/connectors/youtube/{start,callback,sync,disconnect}` | Same four-route shape per platform; generalise to `/api/connectors/[platform]/*` | — |
| CSRF `state` cookie pattern in `start/route.js` | Reuse verbatim | — |
| `youtube_videos`, `youtube_channel_stats_daily` | Per-platform equivalents, or one unified table | `published_posts` |
| `YoutubeConnectorCard` | Generalise to a per-platform card in a grid | — |
| `ui/calendar.jsx` — implemented, zero imports | Scheduling UI | — |

---

## Problem

A creator delivers a clip and the engagement ends. What happens next — posting, scheduling, measuring — happens somewhere else entirely.

Three costs:

1. **The payout model is only half-supported.** Per-view CPM payouts depend on view counts, which only exist for YouTube. A clip destined for TikTok can't use per-view pricing at all, which is the platform's best pricing model.
2. **Attribution dies at delivery.** Campaign ROI ([`07-analytics.md`](./07-analytics.md)) is unanswerable when the platform can't see where the clip went or how it did.
3. **The brand does the last mile manually.** Downloading a file and posting it to five platforms is exactly the tedium they hired someone to avoid.

Short-form is inherently multi-platform — the same clip goes to Reels, Shorts, and TikTok. Being YouTube-only means covering roughly a third of the actual workflow.

## Approach

```
Clip approved
  → brand or creator picks destinations + schedule
  → publish now, or queue via ui/calendar.jsx
  → platform API posts it
  → post-back sync pulls views/engagement per platform
  → feeds per-view payouts, campaign ROI, and creator stats
```

Publishing rights belong to whoever owns the destination account. Usually the brand publishes to brand accounts; sometimes the creator publishes to their own — which is a different product (influencer distribution) and should be modelled explicitly via a `publish_as` field rather than left ambiguous.

## Schema sketch

```sql
create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  platform text not null check (platform in
    ('youtube','instagram','tiktok','linkedin','x','facebook')),
  external_account_id text not null,
  account_name text,
  account_thumbnail_url text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[] default '{}',
  verification_method text check (verification_method in ('linked','bio_code')),
  verified_at timestamptz,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (platform, external_account_id, coalesce(user_id, workspace_id))
);

create table public.published_posts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.campaign_submissions(id) on delete set null,
  connection_id uuid not null references public.social_connections(id) on delete cascade,
  platform text not null,
  external_post_id text,
  post_url text,
  caption text,
  scheduled_for timestamptz,
  published_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','publishing','published','failed','deleted')),
  error text,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  share_count bigint,
  stats_synced_at timestamptz,
  created_at timestamptz not null default now()
);
```

Either `user_id` or `workspace_id` is set, never both — a connection belongs to a creator or to a brand workspace.

## Open decision: where does verification live?

**This blocks the migration and needs answering first.**

`payout_multiplier` currently sits on `youtube_connections` and is read directly in `src/app/api/payments/submissions/[id]/approve/route.js:51`. Generalising to multiple platforms forces a choice:

**Option A — verification is per-platform.** Each connection carries its own tier; the payout multiplier is chosen based on which platform the submission targets. Precise, but the approve route needs to know the destination platform, and a creator verified on YouTube but not TikTok gets inconsistent rates for equivalent work.

**Option B — verification is per-creator (recommended).** The multiplier moves to `clipper_profiles.payout_multiplier`, computed as the best tier across all connected platforms. Verification becomes an identity property, not a channel property. The approve route reads one field regardless of destination, and connecting a second platform can only ever help.

Option B also simplifies the migration: backfill `clipper_profiles.payout_multiplier` from `youtube_connections`, change one line in the approve route, and `social_connections` never carries payment logic at all.

Whichever is chosen, `youtube_connections` should be kept as a live table through at least one release, with `social_connections` backfilled from it and the sync routes dual-writing — the same four-deploy pattern as the workspaces migration in [`04-workspace.md`](./04-workspace.md).

## Other decisions and risks

- **Token storage.** Access and refresh tokens are stored as plain `text` today, and adding five more platforms multiplies the exposure. Supabase Vault or column encryption should land with this phase, not after. See the security note in [`90-architecture.md`](./90-architecture.md).
- **API access is the real constraint, not engineering.** TikTok's Content Posting API and Instagram's Content Publishing API both require app review, have restrictive rate limits, and grant metrics that differ sharply per platform. Scope this phase around what the APIs actually permit — start with the two that approve fastest rather than building all six speculatively.
- **Metrics are not comparable across platforms.** A TikTok "view" and a YouTube "view" count different things. Per-view payouts must specify which platform's metric governs, in the contract terms snapshot.
- **Scheduled publish needs a scheduler.** No cron or queue exists in the codebase today. Vercel Cron plus a status-driven table is the minimum.
- **Failed publishes** need bounded retry and a clear surface — a silently failed scheduled post is a broken promise to the brand.
- **Deleted posts** break per-view payouts mid-flight. Snapshot view count at approval; don't recompute from a post that may vanish.

## AI opportunities

Per-platform caption and hashtag variants from one clip (conditioned on brand voice); optimal posting time from the account's own historical engagement; automatic aspect-ratio and duration adaptation per destination; cross-platform performance comparison feeding the viral score model.

## Future improvements

Cross-posting analytics rollup; first-comment automation; A/B testing the same clip with different hooks per platform; UTM and link attribution back to site conversions; a "distribution-only" campaign type where the creator supplies audience rather than editing.
