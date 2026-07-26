# Analytics

**Phase 4.** Condensed spec. Campaign ROI, engagement, reach, revenue, top creators, top campaigns, leaderboards, AI recommendations.

## Reuse triage

| Already built | Extend this | Genuinely new |
|---|---|---|
| `/analytics` page + `AnalyticsSummaryCards` + `AnalyticsChart` (recharts) | Creator-side analytics exist and work. Reuse the card and chart components wholesale | Brand-side analytics |
| `/dashboard` + `DashboardSummaryCards` | Same components, brand-side metrics | — |
| `youtube_channel_stats_daily`, `youtube_videos` | Creator performance source | `campaign_stats_daily` |
| `VideoAnalyticsTable` — the **only** `@tanstack/react-table` implementation in the codebase | The reference for every sortable table added here | — |
| `ui/chart.jsx` (recharts wrapper with `ChartContext`) | Use as-is for all new charts | — |
| `campaign_payouts` | Revenue and spend rollups | `platform_revenue` view |
| `creator_stats` materialized view (from [`01-marketplace.md`](./01-marketplace.md)) | Extend with delivery and engagement metrics | Leaderboards |
| `/admin` — 9 parallel service-role queries joined in memory | Works at current scale; the pattern to replace with views as data grows | — |

Charting infrastructure is done. This phase is mostly queries and one honest measurement problem.

---

## Problem

The platform measures the creator side well and the brand side not at all.

A brand that has spent ₹400,000 across eleven campaigns cannot answer: which campaign performed best, which creator delivers the most views per rupee, what the cost per thousand views actually was, or whether any of it drove a business outcome. That's the question that determines whether they renew, and the product has no answer.

The asymmetry is odd given that the platform already has verified performance data — it's just pointed at the creator's dashboard rather than the brand's.

## Approach

Three surfaces, in build order:

**1. Campaign analytics** (per campaign) — spend, clips delivered, total verified views, effective CPM, cost per view against target, per-creator breakdown, view curves over time. Composes entirely from existing card and chart components.

**2. Workspace analytics** (across campaigns) — total spend, blended CPM, top campaigns, top creators, spend trend, budget utilisation. Answers "is this working."

**3. Platform analytics** (`/admin`) — GMV, take rate, active brands and creators, liquidity (proportion of campaigns receiving ≥3 proposals), time-to-first-proposal, completion rate, and the funnel from campaign created → funded → hired → delivered → released. These are the operating metrics; the existing admin page already fetches most of the raw data.

## The honest measurement problem

**Cost per view is not ROI.** A brand cares about pipeline, signups, and sales — not views. Any dashboard that labels a CPM chart "ROI" is lying, and sophisticated buyers will notice immediately.

Two options, and it's worth being explicit about which one is being sold:

- **Report what's measured.** Call it "delivery and reach performance." Honest, useful, and doesn't overclaim.
- **Close the loop properly.** UTM links on published posts plus a conversion pixel or webhook from the brand's own analytics. Real ROI, materially more work, and only feasible after publishing lands in Phase 4.

Recommendation: ship reach and efficiency metrics under an accurate name in Phase 4, and treat true attribution as a Phase 5 enterprise feature where the buyer will actually do the integration work.

## Schema sketch

```sql
-- Daily rollup per campaign, populated by a scheduled job
create table public.campaign_stats_daily (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  date date not null,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  clips_delivered int not null default 0,
  spend numeric not null default 0,
  primary key (campaign_id, date)
);

-- Leaderboards; refreshed on a schedule, not per request
create materialized view public.creator_leaderboard as
select
  cp.user_id,
  cs.verified_views,
  cs.avg_rating,
  cs.completed_campaigns,
  round(cs.verified_views::numeric
        / nullif(cs.completed_campaigns, 0), 0) as avg_views_per_campaign
from public.clipper_profiles cp
join public.creator_stats cs on cs.user_id = cp.user_id
where cp.is_public = true
  and cs.completed_campaigns >= 3;
```

The `completed_campaigns >= 3` floor keeps a creator with one lucky viral clip off the top of the leaderboard. Small-sample ranking is the fastest way to make a leaderboard untrustworthy.

## Leaderboards

Public, category-scoped, ranked on verified delivered views blended with rating — never on self-reported anything. This is a supply-side growth mechanic: creators share their ranking, which recruits other creators, which is the cheapest acquisition channel a marketplace has.

Guardrails: minimum campaign floor, category scoping so one broad category doesn't dominate, a rolling window so early users don't hold the top permanently, and opt-out.

## AI recommendations

Reusing `ai_jobs` from [`03-ai.md`](./03-ai.md) rather than new infrastructure:

- **For brands** — "your podcast clips outperform your product demos 3:1; shift budget"; "creators in this tier deliver 40% more views at the same rate"; budget pacing warnings.
- **For creators** — "campaigns in this category pay 25% above your current rate"; "your delivery time is above the median in your tier"; portfolio gap analysis.
- **For the platform** — churn prediction, liquidity alerts on categories with demand and no supply, fraud signals from anomalous view curves.

Every recommendation must state its evidence. An unexplained recommendation gets ignored once and distrusted after that.

## Decisions and risks

- **Rollups, not live aggregation.** `/admin` currently runs nine parallel service-role queries and joins in memory. Fine now, quadratic later. Analytics should read from materialized views and daily rollup tables refreshed on a schedule.
- **Stale-data honesty.** Every number carries an "as of" timestamp. Platform sync lag is real and pretending otherwise generates support tickets.
- **Timezones.** Daily rollups need one canonical timezone. Given `en-IN` formatting throughout, IST is the sensible default — stated explicitly, not implied.
- **Creator privacy.** Aggregate creator performance is public; per-campaign earnings are not. A brand must not be able to infer what a competitor paid.
- **Locale inconsistency exists today** — currency and counts are `en-IN` on campaign and admin surfaces but `en-US` in analytics (`dashboard-summary-cards.jsx`, `video-analytics-table.jsx`). Fixed by `lib/format.js` in Phase 1 ([`91-design-system.md`](./91-design-system.md)); analytics work should assume it's already done.

## Future improvements

Scheduled email and PDF reports for brand stakeholders; benchmark data ("your CPM vs category median"); cohort retention for both sides; a public transparency report on marketplace liquidity; forecasting for budget planning.
