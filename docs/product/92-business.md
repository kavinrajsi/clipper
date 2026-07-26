# Business

Business model, competitive positioning, mobile roadmap, scaling strategy.

---

## Business model

Revenue detail is in [`08-monetisation.md`](./08-monetisation.md). The strategic shape:

**Commission on GMV is the foundation.** It scales with value delivered, needs no new payment infrastructure (verified — `createHeldTransfer` already retains the platform's cut), and can start at the first transaction. Everything else is leverage on a relationship that commission establishes.

**The constrained side is supply.** Brands with content and budget are relatively easy to find. Creators who reliably ship good short-form on deadline are not. Every pricing and product decision should protect creator economics — which is why the fee recommendation is brand-borne, and why per-view CPM matters more than a race to the lowest flat fee.

**Unit economics to watch, in order:**

1. **Take rate** — 5% of actual creator payouts, brand-borne, charged from a prepaid wallet balance. Deliberately low to buy liquidity; adjustable by super admin and reducible on higher subscription tiers. Because the fee is charged on spend rather than on funded budget, effective rate is exactly 5% regardless of campaign underspend. Watch whether it covers Razorpay costs plus AI COGS as usage grows.
2. **Float** — customer balance held in the wallet. Watch `wallet_liability` in `/admin`: it is refundable on demand, so it is a liability, not revenue, and it carries the regulatory question flagged in [`08-monetisation.md`](./08-monetisation.md).
3. **GMV per brand per quarter** — the retention metric that actually predicts revenue.
4. **Repeat hire rate** — the single strongest signal of marketplace health. Invite-only campaigns ([`02-hiring.md`](./02-hiring.md)) exist largely to raise this.
5. **AI gross margin** — the one stream with real COGS. Meter from day one via `ai_jobs`.
6. **CAC by side** — creator acquisition should trend toward near-zero through public profiles and leaderboards; brand CAC is the number that must stay under control.

**The liquidity problem comes first.** A marketplace with 500 creators and 5 brands fails, and so does the reverse. Early on, concentrate ruthlessly — one vertical (podcast clipping is the obvious wedge, since the source content already exists and the buyer already feels the pain), one geography, and hand-matched hiring until organic proposal volume takes over. Breadth is a Phase 4 concern.

---

## Competitive positioning

**A methodological note, deliberately.** Feature sets and pricing at Upwork, Fiverr, Contra, Toptal, and Passionfruit change frequently, and specifics asserted from memory into a strategy document get acted on and turn out wrong. What follows compares on **structural axes** — how work gets scoped, how trust is established, how payment is structured, and how the platform takes its cut. Those move slowly and are what actually determine competitive dynamics. Verify any current specifics directly before using them in a pitch or a pricing decision.

### The four axes

**1. How work gets scoped.** General freelance marketplaces require the buyer to write a brief before anything happens. That's the hardest step, it's done by the least-equipped person, and it's where most projects fail before they start. Clipper's thesis is to invert it: the buyer uploads content and makes selection decisions instead of authoring decisions ([`03-ai.md`](./03-ai.md)). No general marketplace can copy this, because it requires being in the content pipeline rather than the contracting pipeline.

**2. How trust is established.** Generalist marketplaces rely on reviews, badges, and platform-run vetting. Reviews are claims and are gameable at scale; human vetting is expensive and doesn't scale. Clipper can measure the actual deliverable — OAuth-verified channel ownership plus synced view counts mean the platform can assert delivered performance with provenance ([`01-marketplace.md`](./01-marketplace.md)). This is the durable moat, and it exists only because the work product is inherently measurable. It would not transfer to design or copywriting.

**3. How payment is structured.** The general options are hourly, fixed-price, and milestone escrow. Clipper already supports something none of them do at the platform level: **per-view CPM with held escrow**, where the payout computes from verified performance at approval time. That aligns both sides on outcome rather than effort. It is the most differentiated thing already built, and it's currently undersold.

**4. Take-rate model.** Percentage commission is near-universal; the variations are flat vs sliding, and who bears it. Clipper's lever is a lower rate at higher subscription tiers, which makes the upgrade path arithmetic rather than persuasive.

### Where Clipper is structurally weaker

Worth stating plainly:

- **Cold-start liquidity.** Incumbents have millions of users. Clipper has none, and no amount of product quality substitutes for supply in the first year.
- **Category breadth.** A brand needing an editor *and* a designer will prefer one platform for both. Clipper deliberately gives this up — see the "not building" list in [`00-roadmap.md`](./00-roadmap.md).
- **Trust by default.** Established marketplaces have brand recognition and dispute processes with years of precedent. New platforms are asked to hold escrow by people who've never heard of them.
- **Geographic and payment reach.** Razorpay Route is India-centric. International expansion means a second payment provider and a meaningful rebuild of the payout layer.

### The positioning sentence

> The marketplace where you upload your content, not write a brief — and pay creators for views they can prove.

Both halves are things a generalist marketplace structurally cannot say.

---

## Mobile roadmap

**Phase 5, and deliberately late.** The temptation is to build an app early because short-form is a mobile-native category. Resist it — the work being done here is *brand-side campaign management* and *creator-side editing*, and neither happens on a phone. Editing happens on a desktop; approvals happen wherever the reviewer is.

**Stage 1 — Responsive web, now (Phase 1).** Everything ships mobile-responsive from the start. The `useIsMobile()` hook exists, container queries are already in use, and the sidebar already collapses. This covers approvals, messaging, and notifications, which are the genuinely mobile-shaped tasks.

**Stage 2 — PWA (Phase 4).** Installable, with web push for notifications and messages. Small increment over responsive web, and it captures most of the real mobile value: a brand approving a clip from their phone.

**Stage 3 — Native, creator-first (Phase 5).** If and only if usage data justifies it, and creator-side first, not brand-side. The creator app's job is capture and upload from the phone, notification-driven work acceptance, and earnings — not editing. Camera and share-sheet access are the only things genuinely requiring native.

**Validate before building:** what proportion of approvals already happen on mobile web, and what proportion of creators would upload from a phone if they could. Both are measurable before writing any Swift or Kotlin.

---

## Scaling strategy

### Technical

Ordered by when the pressure actually arrives, not by interest. Detail in [`90-architecture.md`](./90-architecture.md).

1. **Caching.** There is none — no `use cache`, no ISR, no revalidation tags. Public creator profiles are read-heavy and near-static; they're the obvious first candidate and arrive with Phase 1.
2. **Indexes on RLS join columns.** Every `exists()` policy is a query. `campaign_applications(campaign_id)` and `workspace_members(user_id)` become hot paths immediately after Phase 2.
3. **Materialized views for aggregates.** `/admin`'s nine parallel queries with in-memory joins are fine now and won't be at 10k users.
4. **A job queue**, required before Phase 3 — AI work cannot run in route handlers.
5. **Retention policies.** `youtube_videos`, `notifications`, `ai_jobs`, and source media all grow unbounded. Source media is the expensive one: retain during an active campaign plus 30 days, then keep transcripts and derived metadata only.
6. **Realtime connection limits** are per-plan; chat at scale needs a pooling strategy.

### Operational

- **Dispute resolution** needs a real process before it needs software. Escrow means the platform will be asked to adjudicate, and the first ten disputes should be handled by a human writing down what they decided and why. That transcript becomes the policy, and eventually the admin queue.
- **Fraud** has two shapes: purchased views inflating per-view payouts (detectable from view-curve anomalies — the highest-value model in the system), and collusion between a fake brand and creator to launder money through the platform. Both need monitoring before they need automation.
- **Support** scales on documentation. The FAQ and support pages already exist and are the right place.
- **Trust and safety** — content moderation on uploads, plus a report path in chat from day one rather than retrofitted.

### Team shape

Roughly, by phase: Phases 1–2 are product and full-stack work on an existing codebase. Phase 3 is the first genuine specialisation — media pipeline and ML — and is where an outside hire is most likely needed. Phases 4–5 add platform integration work and, more importantly, the first non-engineering roles: trust and safety, and marketplace operations for hand-matching in the cold-start period.

The cold-start work is not engineering. Budget for it.

---

## Risks worth naming

| Risk | Why it matters | Mitigation |
|---|---|---|
| Cold-start liquidity | The default failure mode for every marketplace | One vertical, one geography, hand-matched hiring, ops headcount |
| Disintermediation | Both sides are incentivised to transact off-platform after the first hire | Make the platform genuinely more useful post-hire — chat, annotations, AI, publishing — rather than policing contact exchange |
| Per-view payout gaming | Directly attacks the escrow | View-curve anomaly detection; snapshot at approval; verification tiers |
| AI cost outrunning revenue | The one stream with real COGS | Meter from day one via `ai_jobs`; credits on higher tiers only |
| Platform API dependence | TikTok and Instagram publishing APIs are gated and can change terms | Start with the platforms that approve fastest; never make one platform load-bearing |
| Plaintext PII | PAN, bank details, and OAuth tokens sit in plain columns today | Encryption before Phase 4 multiplies the token surface — see [`90-architecture.md`](./90-architecture.md) |
| Unspent budget retention | Currently silent and accidental | Decide the refund policy before commission ships ([`08-monetisation.md`](./08-monetisation.md)) |
