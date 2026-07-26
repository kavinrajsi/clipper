# Clipper — Product Specification

The plan for turning Clipper from a working two-sided payment rail into the marketplace short-form creators and brands actually run their business on.

## How to read this

| Doc | What's in it |
|---|---|
| [`00-roadmap.md`](./00-roadmap.md) | Phases 1–5, sequencing, and why each thing lands where it does |
| [`01-marketplace.md`](./01-marketplace.md) | Public profiles, discovery, search, verification, ratings, reviews, follows, saves |
| [`02-hiring.md`](./02-hiring.md) | Job posts, invite-only campaigns, proposals, milestones, contracts, revisions, delivery |
| [`03-ai.md`](./03-ai.md) | Highlight detection, viral score, hooks, captions, subtitles, thumbnails, brand voice, quality score |
| [`04-workspace.md`](./04-workspace.md) | Teams, roles, brand kit, asset library, approval workflow, campaign templates |
| [`05-collaboration.md`](./05-collaboration.md) | Chat, comments, video annotations, timeline feedback, notifications, activity feed |
| [`06-publishing.md`](./06-publishing.md) | Multi-platform connections, scheduling, auto-publish |
| [`07-analytics.md`](./07-analytics.md) | Campaign ROI, engagement, reach, revenue, leaderboards, AI recommendations |
| [`08-monetisation.md`](./08-monetisation.md) | Commission, subscriptions, enterprise, agencies, AI credits, featured placements |
| [`90-architecture.md`](./90-architecture.md) | Sitemap, ERD, API architecture, component hierarchy, folder structure |
| [`91-design-system.md`](./91-design-system.md) | Completing the design system that already exists |
| [`92-business.md`](./92-business.md) | Business model, competitive analysis, mobile roadmap, scaling |
| [`sql/`](./sql/) | Phase 1 migrations, staged and copy-ready — **not applied** |

Factual baseline for the current system is [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Read that first if you haven't; this document assumes it.

## Every feature doc opens the same way

A **reuse triage** table, answering the development rules directly — does this already exist, can it be extended, what's genuinely new:

| Already built | Extend this | Genuinely new |
|---|---|---|

Then the nine-part template: problem, user flow, UI screens, database schema, APIs, permissions, edge cases, AI opportunities, future improvements. Phase 1–2 features get the full template. Phase 3–5 features get problem, schema sketch, and phase rationale — they'll be re-specified when they're actually built, and pretending otherwise wastes your time.

## The product thesis

Three claims this whole plan rests on. If any of them is wrong, large parts of the roadmap change.

### 1. The wedge is the clip, not the contract

Upwork sells scoped hours. Fiverr sells packaged deliverables. Both make the buyer do the hard part first: figure out what they want, write it down, and judge proposals against it.

A brand with a two-hour podcast doesn't know what they want. They know they have content and no time. So Clipper should invert the flow — **upload the source asset, get AI-detected highlight candidates, and let the campaign brief generate itself from the content.** The brand picks three moments they like and hires against those, instead of writing a creative brief into a void.

This is the AI-first workflow, and it's the thing no incumbent can copy quickly, because it requires being in the content pipeline rather than the contracting pipeline.

### 2. Trust is verified performance, not stars

Every marketplace eventually drowns in review fraud, because a review is just a claim. Clipper is unusual in that it can measure the thing being reviewed.

Half of this exists already: `youtube_connections` holds OAuth-verified channel ownership with two verification tiers (`linked` = 1.0× payout, `bio_code` = 0.75×), and `youtube_videos.view_count` is synced from the YouTube API. That means the platform can state, with cryptographic provenance, *"this creator has delivered 4.2M verified views across 31 campaigns."*

So: reviews are gated on a released payout at the RLS level, and creator ranking blends verified delivered performance with subjective ratings. A creator cannot buy the top of the leaderboard.

### 3. Per-view escrow is the real differentiator

Fiverr is flat-fee gigs. Upwork is hourly or fixed-price milestones. Clipper already supports **per-view CPM payouts with held escrow** — the brand funds a budget, the payout computes from actual synced view counts at approval time, and the transfer sits on hold until released.

That aligns incentives in a way fixed-price work can't: the creator earns more by making something that performs, and the brand pays for outcomes. This is the pricing model to lean into, not something to replace with conventional contracts.

## What the codebase already gives us for free

Findings from reading the source that materially change what "missing" means:

- **16 of 18 `src/components/ui/` primitives are fully implemented and imported by nothing.** The complete chat kit (`message`, `bubble`, `message-scroller`, `attachment`, `marker`), the command palette (`command`, `combobox`, `kbd`, plus the `cmdk` dependency), `empty`, `item`, `calendar`, `progress`, `drawer`, `carousel`, `resizable`. Chat, ⌘K discovery, rich empty states, and upload UI need **zero new dependencies**.
- **Supabase Realtime ships inside `@supabase/supabase-js` and is used nowhere** — zero `.channel()` calls in the entire codebase. Live chat and notifications need publication config and client plumbing, but no install.
- **Platform commission needs no new payment infrastructure.** `createHeldTransfer(paymentId, accountId, amount)` (`src/lib/razorpay.js:112`) transfers only `amount` to the creator; the remainder of the captured payment already sits in the platform's Razorpay account. Commission is arithmetic in the approve route, not infrastructure.
- Already paid for and unused: `date-fns` (zero imports), `next-themes` (installed, no provider mounted — dark mode isn't wired), `<Toaster/>` (mounted, zero `toast()` calls), `Skeleton` (zero consumers), `@tanstack/react-table` (1 of 6 tables).

And the genuine greenfield, where you'll be setting the first convention rather than following one: no AI SDK, no email provider, no validation layer, no hooks or context or query layer, no tests, and no `loading.js` / `error.js` anywhere in the app.
