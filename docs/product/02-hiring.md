# Hiring

**Phase 1:** job posts, invite-only campaigns, public campaigns, proposals, cover letters, portfolio attachments.
**Phase 2:** milestones, contracts, revisions, delivery tracking.

## Reuse triage

| Already built | Extend this | Genuinely new |
|---|---|---|
| `campaigns` — title, description, requirements, payout structure, budget, deadline, status, funding | Add `visibility`, `slug`, `max_applicants`, `template_id` | — |
| `campaign_applications` — `message` is already the cover letter, `status` is already pending/approved/rejected | Add `bid_amount`, `estimated_delivery_days`, `withdrawn_at` | `proposal_attachments` |
| `campaign_submissions` — one submission per application, `status` submitted/approved/rejected | Add `revision_number`, `parent_submission_id`, `delivery_state` | `revision_requests` |
| `campaign_payouts` — one payout per application (`unique(application_id)`) | Relax to allow one payout **per milestone**; add `milestone_id` | `campaign_milestones` |
| Funding flow (`/api/payments/campaigns/[id]/fund` + `/verify`) | Reuse unchanged for milestone-funded campaigns | — |
| Approve/release routes | Extend to be milestone-aware | — |
| `CampaignForm`, `CampaignCard`, `CampaignApplicationsList`, `MyApplicationsTable`, `SubmissionForm` | Extend all five | — |
| `ui/attachment.jsx` — implemented, zero imports | Use for proposal and delivery attachments | — |
| `ui/progress.jsx`, `ui/item.jsx` — implemented, zero imports | Milestone progress, delivery timeline | — |
| Supabase Storage `avatars` bucket + the duplicated upload block in `brand-profile-form.jsx` / `profile-form.jsx` | Extract to `lib/storage.js`; add an `attachments` bucket | — |

The `campaign_payouts.unique(application_id)` constraint is the one real structural blocker, and it's a Phase 2 concern — see Milestones below.

---

## 1. Campaign visibility: public, invite-only, private

**Phase 1.**

### Problem

Every campaign is public to every clipper. Three things break:

1. **No repeat hiring.** A brand who found a great creator must post publicly and hope that creator notices, competing against fifty applicants. Repeat hiring is the strongest retention mechanic in any marketplace, and the product actively obstructs it.
2. **No confidential briefs.** An unannounced product launch can't be described in a public campaign. Enterprise brands simply can't use the platform.
3. **Application spam.** Popular campaigns collect dozens of low-effort applications, so brands stop reading them and the signal dies.

### User flow

```
Brand creates campaign → chooses visibility:

  Public      → listed in /campaigns for all clippers, open applications
  Invite-only → unlisted; only invited creators can see and apply
  Private     → unlisted; a single named creator, pre-agreed terms,
                 no application step — a direct offer

Invite-only / private:
  Brand picks creators from saved list, search, or a past-hire list
  → invite sent (notification + email)
  → creator sees it under /invitations, accepts or declines
  → accept creates a campaign_application, pre-approved
```

Private visibility collapses the whole apply-and-approve dance into a single offer-and-accept, which is what repeat hires actually want.

### UI screens

**Campaign creation** (extends `CampaignForm`) gains a visibility segmented control with inline explanation. Choosing invite-only or private reveals a creator picker — a `Combobox` (`ui/combobox.jsx`, currently unused) searching saved creators, past hires, and directory results.

**`/invitations`** — creator-side list of pending invites with brand, payout, deadline, and personal message. Accept / Decline / view campaign.

**Campaign detail** gains an "Invited" tab beside Applicants, showing invite status per creator (sent / viewed / accepted / declined / expired).

### Database schema

```sql
alter table public.campaigns
  add column visibility text not null default 'public'
    check (visibility in ('public','invite_only','private')),
  add column slug text unique,
  add column max_applicants int;

create table public.campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  clipper_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  message text,
  status text not null default 'sent'
    check (status in ('sent','viewed','accepted','declined','expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, clipper_id)
);
```

`default 'public'` keeps every existing campaign behaving exactly as it does today. Backward compatible by construction.

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/campaigns/[id]/invites` | `POST` | Invite one or more creators |
| `/api/campaigns/[id]/invites/[inviteId]` | `PATCH` | Accept / decline |
| `/api/campaigns/[id]/invites/[inviteId]` | `DELETE` | Rescind (brand only, before acceptance) |

### Permissions

The existing clipper-facing campaign policy — `status = 'active' and funding_status = 'paid'` — must gain a visibility clause, or invite-only campaigns leak into the public list:

```sql
-- replaces "Clippers can view funded active campaigns"
create policy "Clippers can view available campaigns"
  on public.campaigns for select
  to authenticated
  using (
    (status = 'active' and funding_status = 'paid' and visibility = 'public')
    or brand_id = (select auth.uid())
    or exists (
      select 1 from public.campaign_invites ci
      where ci.campaign_id = campaigns.id
        and ci.clipper_id = (select auth.uid())
    )
  );
```

> **Fix the broken policy while you're here.** `campaigns` currently has a policy "Clippers can view campaigns they applied to" whose predicate is self-referential (`a.campaign_id = a.id`), so it never matches. It should compare against `campaigns.id`. Rewriting it as part of this migration is the natural moment. See [`90-architecture.md`](./90-architecture.md).

Invites: pattern 2 — a creator reads invites addressed to them; a brand reads invites on campaigns they own.

### Edge cases

- **Invite to a creator who later unpublishes or deletes** → cascade removes the invite; the brand sees "creator unavailable."
- **Campaign unfunded when the invite is accepted.** The DB constraint already prevents `status='active'` without `funding_status='paid'`. Accepting an invite on an unfunded campaign should hold the application in a `pending_funding` state rather than failing opaquely.
- **Visibility changed after invites are sent.** Public → invite-only must not orphan existing applications. Keep them; just stop new ones.
- **Expired invites** need a scheduled sweep to flip `sent` → `expired`; don't rely on read-time computation, because notifications need the state transition.
- **`max_applicants` reached** → campaign shows as closed to new applicants but stays visible to existing ones.
- **Slug collisions** with reserved routes — same denylist as creator handles.

### AI opportunities

Suggested invitees ranked by fit between the brief and verified performance in that category; predicted acceptance likelihood so a brand invites five likely creators rather than fifty unlikely ones; auto-drafted personal invite messages referencing the creator's actual work.

### Future improvements

Invite templates; bulk invite from a saved collection; invite links with a token for off-platform outreach; auto-invite rules ("invite my top 3 past creators whenever I post in this category").

---

## 2. Proposals

**Phase 1.**

### Problem

An application today is a single free-text `message` and nothing else. The brand cannot compare applicants on any structured dimension — no price, no delivery estimate, no relevant samples. So they compare on vibes, or on whoever applied first.

The creator's side is worse: no way to differentiate except writing more text, and no way to attach the one clip that proves they can do this exact job.

### User flow

```
Creator opens a campaign → Apply
  → cover letter (existing `message` field)
  → bid: accept the posted rate, or propose their own
  → estimated delivery in days
  → attach up to 5 portfolio items (from portfolio, or upload)
  → submit

Brand sees a comparable table:
  creator | verified views | rating | bid | delivery | samples
  → shortlist, message, or approve
```

Bidding is optional and defaults to the posted rate. Making it mandatory turns every campaign into a price race to the bottom, which destroys creator margin and eventually supply.

### UI screens

**Proposal form** — a `Sheet`, not a modal; it's long enough that a modal fights the content. Sections use the existing `Field` / `FieldSet` primitives, matching every other form in the app. Attachments use the unused `ui/attachment.jsx`.

**Applicant comparison** (extends `CampaignApplicationsList`) becomes a sortable table via `@tanstack/react-table` — already a dependency, currently used in exactly one file (`video-analytics-table.jsx`, the reference implementation). Columns: creator, verification, rating, verified views, bid, delivery, sample thumbnails, status. Row actions reuse the existing per-row `loadingId` spinner pattern from `campaign-applications-list.jsx:136`.

### Database schema

```sql
alter table public.campaign_applications
  add column bid_amount numeric,
  add column estimated_delivery_days int,
  add column withdrawn_at timestamptz;

create table public.proposal_attachments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.campaign_applications(id) on delete cascade,
  portfolio_item_id uuid references public.portfolio_items(id) on delete set null,
  file_url text,
  title text,
  created_at timestamptz not null default now()
);
```

`message` stays as the cover letter — no new column, no migration of existing data.

**`bid_amount` interacts with payout computation.** The approve route currently reads `campaign.payout_rate`. Once bids exist, it must prefer `application.bid_amount` when set. That's a one-line change in `src/app/api/payments/submissions/[id]/approve/route.js`, and it must land in the same release as the bid field or bids will be silently ignored.

### APIs

Applications are currently created client-side via the Supabase client in `campaign-card.jsx`. Proposals should move to a route handler, because they now have cross-cutting validation (budget bounds, duplicate check, campaign state, attachment ownership):

| Route | Method | Purpose |
|---|---|---|
| `/api/campaigns/[id]/apply` | `POST` | Submit a proposal with attachments |
| `/api/applications/[id]/withdraw` | `POST` | Creator withdraws |

### Permissions

Existing `campaign_applications` policies mostly hold. Additions:

- A creator may only attach `portfolio_items` they own — enforced in the insert policy with an `exists()` check, not in application code.
- A creator may withdraw only while `status = 'pending'`.
- A brand reads proposals only on campaigns they own (existing pattern 2 policy).
- Bids are visible only to the campaign owner. Never expose competing bids to other applicants — that's how you get collusion and race-to-the-bottom pricing.

### Edge cases

- **Bid above remaining budget** → reject at submission with a clear message, not at approval time. Failing late wastes both parties' effort.
- **Duplicate application** — already prevented by `unique (campaign_id, clipper_id)`.
- **Applying to your own campaign** (a user with both roles, or a super admin) → block explicitly.
- **Attachment deleted from portfolio after applying** → `on delete set null` keeps the proposal intact; render the slot as removed.
- **Campaign cancelled with pending proposals** → notify all applicants. Currently nothing tells them.
- **Withdrawal after approval** → not allowed via withdraw. It's a cancellation, which has payout implications.
- **Storage abuse** — attachments need a size cap, a MIME allowlist, and per-user quota. There is no such enforcement anywhere today.

### AI opportunities

Cover-letter assist that drafts from the creator's portfolio and the brief (with an "AI-assisted" disclosure — hiding it corrodes trust); proposal-quality scoring surfaced privately to the creator before submission; brand-side ranking with plain-language reasoning; automatic duplicate/spam detection on templated proposals blasted at every campaign.

### Future improvements

Proposal templates; saved proposal drafts; video cover letters (high signal for video work); brand-side "request revisions to proposal"; a proposal expiry so stale applications age out.

---

## 3. Milestones & contracts

**Phase 2.**

### Problem

A campaign is a single all-or-nothing payment. That works for one clip. It fails for everything larger — a 10-clip package, a monthly retainer, a launch campaign with staged deliverables. The brand must either pay everything up front (their risk) or the creator works unpaid until the end (their risk). Neither party will do that with a stranger, so large engagements don't happen on the platform at all.

The blocker is structural: `campaign_payouts` has `unique (application_id)`. One payout per application, by constraint.

### User flow

```
Brand creates campaign → "Split into milestones"
  → defines: name, amount, due date, deliverable count (e.g. 3 clips)
  → funds the full campaign budget as today (unchanged)

Per milestone:
  creator delivers → brand approves → held transfer created for THAT milestone
                                     → brand releases → paid
  Campaign completes when every milestone is released.
```

Funding stays whole-budget-up-front. Only the *payout* splits. This is deliberate: it reuses the existing funding flow untouched, and it keeps the creator's guarantee that the money genuinely exists.

### UI screens

Milestone builder inside `CampaignForm` — repeatable rows with a running total validated against `budget`. A progress rail (`ui/progress.jsx`, unused today) on the campaign detail page. Per-milestone approve/release actions in `CampaignApplicationsList`, reusing the existing per-row loading pattern.

### Database schema

```sql
create table public.campaign_milestones (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  description text,
  amount numeric not null check (amount > 0),
  deliverable_count int not null default 1,
  due_date date,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.campaign_payouts
  add column milestone_id uuid references public.campaign_milestones(id) on delete set null;

alter table public.campaign_payouts
  drop constraint campaign_payouts_application_id_key;

create unique index campaign_payouts_application_milestone_key
  on public.campaign_payouts (application_id, coalesce(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

The `coalesce` in the unique index preserves today's behaviour exactly — a non-milestone campaign still gets one payout per application, because every such row has `milestone_id is null` and collapses to the same sentinel.

> **This migration changes a constraint that the approve route's upsert depends on.** `src/app/api/payments/submissions/[id]/approve/route.js` upserts with `onConflict: "application_id"`. That must change to the new index in the same deploy, or approvals break.

Contracts are a generated artifact, not a separate agreement system:

```sql
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.campaign_applications(id) on delete cascade,
  terms_snapshot jsonb not null,
  brand_accepted_at timestamptz,
  clipper_accepted_at timestamptz,
  created_at timestamptz not null default now()
);
```

`terms_snapshot` freezes rate, deliverables, deadline, revision limit, and usage rights at acceptance. Immutable. When a dispute arises, the question "what was actually agreed" has one answer.

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/campaigns/[id]/milestones` | `POST` / `PATCH` / `DELETE` | Manage milestones (locked once funded) |
| `/api/payments/milestones/[id]/approve` | `POST` | Milestone-scoped approve — mirrors the existing submission approve route |
| `/api/contracts/[id]/accept` | `POST` | Record acceptance |

The milestone approve route should share the payout computation with the existing submission approve route rather than copying it. Extract the amount calculation (rate × multiplier, budget check) into `src/lib/payouts.js` and have both call it — that logic is currently inline in one route and would otherwise be duplicated.

### Permissions

Unchanged pattern: brand owns the campaign, verified via the existing ownership check on the RLS-scoped client, then `createAdminClient()` for the cross-user transfer write. `campaign_milestones` reads follow pattern 2 (brand owns campaign, or clipper has an application on it). Milestones are immutable once the campaign is funded.

### Edge cases

- **Milestone amounts exceeding budget** → block at save. Budget is already funded; over-committing creates a payout that can never be created.
- **Deleting a milestone with a released payout** → forbid. `on delete set null` covers accidental cases, but the API should refuse outright.
- **Partial completion / abandonment** → released milestones stay paid; unreleased ones need the refund path that doesn't exist yet (see below).
- **Unspent budget.** This is the important one, and it exists *today*, not just with milestones: a campaign funded at ₹100,000 that pays out ₹60,000 leaves ₹40,000 sitting in the platform's Razorpay account with no refund path. That's currently accidental. Milestones make it obvious and frequent. It must be resolved deliberately in [`08-monetisation.md`](./08-monetisation.md).
- **Multiple creators on one campaign** — the budget check already aggregates across all applications, so milestones must be per-application, not per-campaign, or two creators will both claim the same milestone.

### AI opportunities

Suggest a milestone breakdown from the brief and budget; flag unrealistic due dates against the creator's historical delivery times; predict at-risk milestones from communication and delivery signals.

### Future improvements

Retainer campaigns (recurring monthly milestones); milestone-level revisions; partial release; escrow dispute resolution with an admin adjudication queue.

---

## 4. Revisions & delivery tracking

**Phase 2.**

### Problem

`campaign_submissions` is one-shot: submit a URL, get approved or rejected. Real creative work iterates. Today a rejection is terminal and unexplained, so revision cycles happen in DMs and the platform loses all visibility — which means it can't adjudicate disputes, can't measure delivery quality, and can't tell a creator why they were rejected.

### User flow

```
Creator submits clip v1
  → brand reviews: Approve / Request revision / Reject
  → "Request revision" → structured notes + timestamped annotations (see 05)
  → creator submits v2, linked to v1
  → repeat up to the contract's revision limit
  → approve → existing payout flow, unchanged
```

### UI screens

Version rail on the submission — v1, v2, v3 with status per version, current highlighted. Side-by-side compare for the current and previous version. A revision-request composer combining free text with the timestamped annotations from [`05-collaboration.md`](./05-collaboration.md). Delivery timeline using `ui/item.jsx` (implemented, unused).

### Database schema

```sql
alter table public.campaign_submissions
  add column revision_number int not null default 1,
  add column parent_submission_id uuid references public.campaign_submissions(id) on delete set null,
  add column delivery_state text not null default 'submitted'
    check (delivery_state in
      ('submitted','in_review','revision_requested','approved','rejected'));

create table public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.campaign_submissions(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  notes text not null,
  created_at timestamptz not null default now()
);
```

`delivery_state` is added alongside the existing `status` rather than replacing it, because `status` is read by the approve route and the admin tables. `status` stays the payment-relevant state; `delivery_state` carries the richer workflow. Consolidate later, once nothing depends on the old column.

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/submissions/[id]/request-revision` | `POST` | Create a revision request, transition state, notify |
| `/api/submissions/[id]/resubmit` | `POST` | Submit the next version linked to its parent |

### Permissions

Pattern 2 throughout — brand acts on submissions belonging to campaigns they own; creator resubmits only on their own applications. Revision requests are readable by both parties, nobody else.

### Edge cases

- **Revision limit exceeded** → block further requests, offer a paid additional-revision milestone. Unlimited revisions are how creators get exploited, and the platform should have an opinion about it.
- **Revision requested after a payout is already held** → forbid. Money has moved; that's a dispute, not a revision.
- **Creator abandons mid-revision** → deadline sweep, notify the brand, offer to re-open the campaign.
- **The submitted video URL changes content** — YouTube lets you swap a video's content at the same URL. The `view_count_at_submission` snapshot partially guards the payout, but for approval integrity, snapshot the video title and thumbnail at submission time too.
- **Chain integrity**: `parent_submission_id` must not cycle. Enforce by only ever pointing at a lower `revision_number`.

### AI opportunities

Auto-check a submission against the brief's stated requirements before it reaches the brand, so obvious misses never consume a review cycle; summarise scattered revision notes into an actionable checklist; detect when a "revision" didn't actually change anything material.

### Future improvements

Auto-approve after N days of brand silence (protects creators from ghosting — a real and common failure); delivery SLA tracking feeding the creator's timeliness rating; side-by-side frame-accurate diff.
