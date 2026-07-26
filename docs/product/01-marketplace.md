# Marketplace

**Phase 1.** Public profiles, discovery, search, categories, filters, verified creators, ratings, reviews, followers, saved creators, saved jobs.

## Reuse triage

| Already built | Extend this | Genuinely new |
|---|---|---|
| `/clippers` directory page (`src/app/(protected)/clippers/page.js`) — flat list, no filters, no detail page, auth-gated | Add search/filter params, pagination; move to a public route group | Creator detail page at `/c/[handle]` |
| `clipper_profiles` — `bio`, `categories[]`, `style_tags[]`, `pricing_model`, `rate_amount`, `availability_status` | Add `handle`, `headline`, `location`, `languages[]`, `is_public`, `search_vector` | — |
| `ClipperDirectoryCard` (`src/components/clipper-directory-card.jsx`) | Add verification badge, rating, delivered-views stat | — |
| `youtube_connections.verification_method` (`linked` / `bio_code`) + `payout_multiplier` | Surface in UI as a badge — the data exists and is currently invisible to brands | — |
| `youtube_videos.view_count`, `youtube_channel_stats_daily` | Aggregate into a verified-performance stat on the profile | `creator_stats` materialized view |
| `campaign_payouts.status = 'released'` | Use as the RLS gate for who may leave a review | `reviews` table |
| `campaigns` list view for clippers | Add search/filter/sort, saved-jobs state | `saved_campaigns` |
| `ui/empty.jsx`, `ui/command.jsx`, `ui/combobox.jsx`, `ui/kbd.jsx` — implemented, zero imports | Use as-is for empty states and ⌘K search | — |
| `ui/badge.jsx`, `ui/avatar.jsx`, `ui/tabs.jsx` | Reuse directly | — |
| — | — | `follows`, `saved_creators` |

**Nothing here needs a new dependency.** `cmdk` is already installed for the command palette; `empty.jsx` is written and unused.

---

## 1. Public creator profiles

### Problem

A creator on Clipper has no URL. `/clippers` is behind auth, shows a card with a bio and a rate, and has no detail view. Three consequences, in order of cost:

1. **Creators can't market themselves.** No link for a Twitter bio, no portfolio to send a prospective client. So creators don't bring their audience, and the platform pays for every single acquisition.
2. **Brands can't evaluate.** A bio and a rate is not enough to hire someone. There's no work history, no samples, no performance data — even though the platform *has* verified performance data sitting in `youtube_videos`.
3. **Zero organic acquisition.** No public surface means no SEO. Every competitor ranks for "[niche] video editor for hire"; Clipper ranks for nothing.

### User flow

```
Creator completes /clipper-profile
  → picks a handle (validated, unique, reserved-word checked)
  → toggles "Make my profile public"
  → profile live at /c/[handle], indexed, OG image generated

Brand discovers via search / directory / shared link
  → lands on /c/[handle] (no auth required to view)
  → sees: verified badge, delivered views, rating, work samples, rate, availability
  → clicks "Invite to campaign" → auth gate → invite flow (02-hiring)
```

The auth gate on the *action*, not the *view*, is the important detail. Public read, gated write is what makes the SEO work.

### UI screens

**`/c/[handle]` — creator profile (public)**

```
┌────────────────────────────────────────────────────────┐
│  [avatar]  Jordan Reyes                    ✓ Verified   │
│            Podcast clips that actually get watched      │
│            Bengaluru · English, Hindi · Available       │
│                                                          │
│            ★ 4.9 (23)   4.2M verified views   31 clips  │
│                                        [Invite] [Save]  │
├────────────────────────────────────────────────────────┤
│  Work                                                    │
│  ┌──────┐ ┌──────┐ ┌──────┐    9:16 thumbnails,         │
│  │ 9:16 │ │ 9:16 │ │ 9:16 │    view count per clip,     │
│  └──────┘ └──────┘ └──────┘    linked to source         │
├────────────────────────────────────────────────────────┤
│  Rates          ₹2,500 / 1,000 views                    │
│  Categories     Podcast · SaaS · Education              │
│  Style          Fast-cut · Subtitled · Meme-forward     │
├────────────────────────────────────────────────────────┤
│  Reviews (23)                                            │
│  ★★★★★  "Turned around 6 clips in 48h..."               │
│         — Acme Podcast · Verified hire · Mar 2026        │
└────────────────────────────────────────────────────────┘
```

Reuses `Card`, `Badge`, `Avatar`, `Tabs`, `Separator`. The stat row follows the existing `tabular-nums` treatment from `dashboard-summary-cards.jsx`.

**`/clippers` — directory.** Existing page, plus a filter rail (categories, rate range, availability, verification tier, language) and a sort control (relevance, rating, delivered views, recently active). Empty and zero-result states use `ui/empty.jsx` rather than the current bare `<p>` at `clippers/page.js:50`.

**⌘K command palette.** Global search across creators and campaigns, using the already-vendored `ui/command.jsx` + `cmdk`.

### Database schema

Extends `clipper_profiles` rather than adding a table:

```sql
alter table public.clipper_profiles
  add column handle text unique,
  add column headline text,
  add column location text,
  add column languages text[] default '{}',
  add column is_public boolean not null default false,
  add column published_at timestamptz;
```

`handle` is nullable so existing rows stay valid; it becomes required at publish time, enforced by a check constraint (`is_public = false or handle is not null`). Full SQL in [`sql/`](./sql/).

Portfolio items get their own table because they can come from multiple sources — a synced YouTube video, a manual upload, or later a delivered campaign clip:

```sql
create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('youtube_video','campaign_submission','manual')),
  youtube_video_id text,
  submission_id uuid references public.campaign_submissions(id) on delete set null,
  title text,
  thumbnail_url text,
  video_url text,
  view_count bigint,
  position int not null default 0,
  created_at timestamptz not null default now()
);
```

### APIs

Mostly none — this is Server Component territory, matching how every existing page fetches (`clippers/page.js`, `campaigns/page.js`). New route handlers only where a client mutation is needed:

| Route | Method | Purpose |
|---|---|---|
| `/api/profile/handle/check` | `GET` | Debounced availability check during handle selection |
| `/api/portfolio` | `POST` / `PATCH` / `DELETE` | Manage portfolio items, reorder |

Profile reads happen in the page's Server Component via the existing `createClient()` from `src/lib/supabase/server.js`. No new API surface for reads.

### Permissions

| Actor | Can |
|---|---|
| Anonymous | Read `clipper_profiles` where `is_public = true`, and that row's `portfolio_items` |
| Authenticated | Same, plus invite and save actions |
| Owner | Full CRUD on own profile and portfolio |
| Super admin | Read all, including unpublished |

RLS follows **pattern 1 (owner-only)** for writes, with a public-read policy added for `is_public = true` — the same shape as the existing blanket `using (true)` select policy on `profiles`:

```sql
create policy "Public profiles are readable by anyone"
  on public.clipper_profiles for select
  to anon, authenticated
  using (is_public = true or (select auth.uid()) = user_id);
```

Note this requires the `anon` role, which no current policy grants. That is a deliberate, reviewed widening — it's the first genuinely public data in the system.

### Edge cases

- **Handle squatting and impersonation.** Reserve a denylist (`admin`, `support`, `api`, `login`, plus every existing route segment). Handles are immutable for 30 days after being set, to stop churn breaking inbound links.
- **Route collision.** `/c/[handle]` is deliberately namespaced under `/c/` rather than living at the root, so a handle can never shadow `/campaigns` or a future top-level route.
- **Unpublishing.** Setting `is_public = false` must 404 the page, not 500. Existing inbound links and OG cards degrade to a generic "profile not available."
- **Deleted creator.** `on delete cascade` from `auth.users` removes the profile; reviews written *by* that creator survive on the brand's side (denormalise the author name at write time).
- **Empty portfolio.** A published profile with no work is worse than no profile. Block publishing under 1 portfolio item, and prompt with the creator's synced YouTube videos as one-click candidates.
- **Stale view counts.** `youtube_videos.view_count` is only as fresh as the last sync. Display "as of [date]" rather than implying live numbers.
- **PII.** `location` is free text and optional. Do not add precise geolocation.

### AI opportunities

- **Profile completion coaching** — score profile strength and suggest what's missing, weighted by what actually correlates with getting hired.
- **Auto-generated headline** from the creator's synced video titles and categories.
- **Semantic search** — embed profiles and briefs, match on meaning rather than tag overlap. Postgres `pgvector` is available on Supabase; this replaces the tag filter with "describe the creator you want."
- **Auto-categorisation** — infer `categories[]` and `style_tags[]` from synced videos instead of asking the creator to self-report.

### Future improvements

Custom domains for top creators; profile analytics (views, invite conversion); embeddable portfolio widget; multi-language profiles; a public "open to work" signal that feeds the recommendation engine.

---

## 2. Verification badges

### Problem

The platform performs real channel verification — OAuth-linked ownership (`linked`, 1.0× payout) or a bio-code challenge (`bio_code`, 0.75×) — and then shows the result to nobody. The brand, who is the entire audience for a trust signal, cannot see it. Meanwhile `payout_multiplier` silently reduces a creator's earnings by 25% with no UI explaining why.

### User flow

```
Creator connects YouTube (existing /connectors flow)
  → picks verification method (existing)
  → badge appears on profile, directory card, proposal, and chat identity
  → bio_code creators see: "Verified via bio code · earns 75% rate.
                            Link your channel to earn 100%. [Link now]"
```

Making the multiplier visible turns a hidden penalty into a conversion prompt.

### UI screens

Badge component with three states, rendered inline next to any creator name:

| State | Badge | Tooltip |
|---|---|---|
| `linked` | ✓ Verified (solid) | "Channel ownership verified via Google" |
| `bio_code` | ✓ Verified (outline) | "Verified via bio code" |
| none | *(nothing)* | — |

No "unverified" badge. Negative badges create a caste system and depress supply.

### Database schema

None. Reads `youtube_connections.verification_method` and `verified_at`, which already exist.

### APIs

None.

### Permissions

`youtube_connections` is currently owner-only (pattern 1). Surfacing the badge to brands requires a narrow cross-user read of **two non-sensitive columns only** — never the OAuth tokens:

```sql
create policy "Verification status is publicly readable"
  on public.youtube_connections for select
  to anon, authenticated
  using (true);
```

**This policy is wrong as written and must not be shipped that way** — it exposes `access_token` and `refresh_token`. Column-level grants are the correct mechanism, or better, a security-definer view exposing only `user_id`, `verification_method`, `verified_at`, `channel_title`. The doc records the trap explicitly; the staged SQL implements the view.

### Edge cases

- Creator disconnects YouTube → badge disappears; any cached profile page must revalidate.
- Bio code removed from the channel after verification → nothing currently re-checks. Add a periodic re-verification job, or accept the drift and document it.
- A creator with a verified channel but zero synced videos should not show a "0 verified views" stat — omit the stat rather than showing zero.

### AI opportunities

Anomaly detection on view-count curves to flag purchased views before they inflate a per-view payout. This protects the escrow directly and is the highest-value fraud model in the system.

### Future improvements

Multi-platform verification (Phase 4); a third tier for creators with sustained delivered performance; identity verification for high-value contracts.

---

## 3. Ratings & reviews

### Problem

There is no reputation. Every hire is a first hire, so brands over-index on price and creators can't build a premium. This is the classic cold-start failure mode and it caps marketplace take rate permanently.

The subtlety: most review systems are trivially gameable, and a marketplace with fake reviews is worse than one with none — it teaches users the signal is noise. Clipper's advantage is that it can gate reviews on a *payment that actually happened* and pair the subjective score with objective delivered performance.

### User flow

```
Brand releases a payout (existing flow, /api/payments/payouts/[id]/release)
  → both parties prompted to review, 14-day window
  → reviews stay hidden until BOTH submit, or the window closes
     (double-blind: neither can retaliate against the other's score)
  → published to both profiles, aggregates recomputed
```

Double-blind is what stops reciprocal-inflation, where both sides trade 5 stars to protect their own average.

### UI screens

**Review prompt** — a `Sheet` triggered from the payout release confirmation, and from the notification. Overall 1–5, plus three sub-scores (communication, quality, timeliness), plus free text.

**Review list** — on the profile, grouped by rating with a distribution bar. Each shows: rating, text, brand name, campaign type, "Verified hire" badge, date.

**Aggregate display** — `★ 4.9 (23)`. Below 3 reviews, show the count without the average; small-n averages are misleading.

### Database schema

```sql
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.campaign_applications(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('brand_to_clipper','clipper_to_brand')),
  rating int not null check (rating between 1 and 5),
  communication_rating int check (communication_rating between 1 and 5),
  quality_rating int check (quality_rating between 1 and 5),
  timeliness_rating int check (timeliness_rating between 1 and 5),
  body text,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (application_id, direction)
);
```

`unique (application_id, direction)` means one review per side per engagement — no review-bombing by re-reviewing.

Aggregates go in a materialized view refreshed on write, rather than denormalised counters that drift:

```sql
create materialized view public.creator_stats as
select
  cp.user_id,
  count(distinct r.id) filter (where r.is_published) as review_count,
  round(avg(r.rating) filter (where r.is_published), 2) as avg_rating,
  coalesce(sum(yv.view_count), 0) as verified_views,
  count(distinct pay.id) filter (where pay.status = 'released') as completed_campaigns
from public.clipper_profiles cp
left join public.reviews r on r.subject_id = cp.user_id and r.direction = 'brand_to_clipper'
left join public.youtube_videos yv on yv.user_id = cp.user_id
left join public.campaign_payouts pay on pay.clipper_id = cp.user_id
group by cp.user_id;
```

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/reviews` | `POST` | Submit a review; runs the eligibility check, handles double-blind publication |
| `/api/reviews/[id]/respond` | `POST` | One public response from the subject |

The publication check on `POST`: if the counterpart review exists, publish both. Otherwise hold. A scheduled job publishes unpaired reviews after 14 days.

### Permissions

**Pattern 2 (cross-user `exists()`)**, with the payout gate as the core of the insert policy:

```sql
create policy "Reviews require a released payout"
  on public.reviews for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1
      from public.campaign_applications ca
      join public.campaigns c on c.id = ca.campaign_id
      join public.campaign_payouts pay on pay.application_id = ca.id
      where ca.id = application_id
        and pay.status = 'released'
        and (
          (direction = 'brand_to_clipper' and c.brand_id = (select auth.uid()))
          or (direction = 'clipper_to_brand' and ca.clipper_id = (select auth.uid()))
        )
    )
  );
```

Money moved, or there is no review. This is the anti-fraud property, and it's enforced in the database rather than in application code.

Reads: published reviews are public. Unpublished are visible only to their author.

Updates: none. Reviews are immutable once published — editable for 1 hour after submission and before publication, then frozen. Mutable reviews are a coercion vector ("change your review or I won't hire you again").

### Edge cases

- **Payout released, then disputed/refunded.** Flag the review rather than deleting it; deletion lets a brand erase bad feedback by initiating a chargeback.
- **Retaliation.** Double-blind handles the common case. Beyond that, log a moderation flag when a review's text and score diverge sharply.
- **A single brand hiring one creator ten times** produces ten reviews and a distorted average. Weight repeat-pair reviews down in the aggregate — count them once, plus a "hired again ×9" signal, which is a *stronger* trust indicator than nine reviews anyway.
- **Deleted account.** Reviews survive with a denormalised author display name.
- **Review of a cancelled campaign.** No released payout means no review. Correct by construction.
- **Reviews before any exist.** Show "New to Clipper" rather than an empty section, and lean on the verification badge and delivered-views stat, which don't need a review history.

### AI opportunities

Summarise review corpora into a two-line "what brands say" digest; detect fake or coerced review language; flag reviews whose text contradicts their score; auto-translate for cross-border hiring.

### Future improvements

Private feedback that doesn't publish but feeds internal ranking; response templates; review reminders tuned to when they actually convert; a dispute/moderation queue in `/admin` (extends the existing admin tables).

---

## 4. Follows, saved creators, saved jobs

### Problem

Nothing in the product creates a reason to return. A brand who finds three good creators has to remember their names. A creator who sees a campaign they're not yet ready for has to find it again. This is pure retention plumbing and it's very cheap.

### User flow

Save is a one-click toggle from any card or profile, no confirmation. Saved items appear under `/saved`, tabbed by type. Follows additionally opt the follower into notifications about new work from that creator.

The distinction: **save is a bookmark, follow is a subscription.** Brands save creators for a future campaign; creators follow brands to hear about new campaigns first.

### UI screens

- Bookmark/heart toggle on `ClipperDirectoryCard` and `CampaignCard` (both exist).
- `/saved` page with `Tabs` (Creators, Campaigns) — `ui/tabs.jsx` is already in use in `/admin`.
- Follower count on the public profile.
- Empty states via `ui/empty.jsx`.

### Database schema

Three thin join tables, all following RLS pattern 1:

```sql
create table public.saved_creators (
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_id)
);

create table public.saved_campaigns (
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

create table public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
```

Composite primary keys make the toggle idempotent — an `upsert` can't create duplicates, and there's no id to leak.

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/saves` | `POST` / `DELETE` | Toggle a save (`type`, `target_id`) |
| `/api/follows` | `POST` / `DELETE` | Toggle a follow |

Both are optimistic on the client — toggle immediately, reconcile on failure with a `toast()`. This is the first real use of the mounted-but-never-called `<Toaster/>`.

### Permissions

Owner-only on all three (pattern 1). Follower *counts* are public; follower *lists* are not — exposing who follows whom lets competitors scrape a brand's creator bench.

### Edge cases

- Saving a creator who then unpublishes → the save persists, the card renders as unavailable.
- Saving a campaign that gets cancelled or fully funded → keep it, mark it closed, prompt for similar open campaigns.
- Self-follow blocked by the check constraint.
- Blocked users (future) must cascade to remove follows in both directions.
- High-follower creators: paginate the count display (`4.2k`) rather than rendering an exact number that requires a full count scan.

### AI opportunities

"Creators like the ones you've saved" recommendations from the saved set; alert a brand when a saved creator becomes available or drops their rate; digest emails of new campaigns matching a creator's follow graph and category history.

### Future improvements

Collections/folders for saved creators (an agency shortlisting per client); shared shortlists across a workspace team (Phase 2); saved searches with alerts; "recently viewed."
