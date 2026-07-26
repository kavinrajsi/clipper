# Brand Workspace

**Phase 2.** Team members, roles, brand kit, brand guidelines, asset library, approval workflow, campaign templates.

Contains the single highest-blast-radius change in the roadmap. Read the migration section carefully before scheduling it.

## Reuse triage

| Already built | Extend this | Genuinely new |
|---|---|---|
| `brand_profiles` — `company_name`, `website`, `logo_url`, `industry`, `description`, **`font_name`, `color_code`** | The last two are already a brand kit seed. Repoint at `workspace_id` | — |
| `campaigns.brand_id` — currently an `auth.users` id | **Repoint at `workspaces.id`** — the structural change | `workspaces` |
| `profiles.role` — `brand` / `clipper`, one flag per user | Stays as the account-type flag; per-workspace permissions layer on top | `workspace_members` |
| Supabase Storage `avatars` bucket; upload code duplicated verbatim in `brand-profile-form.jsx:55` and `profile-form.jsx:73` | Extract to `lib/storage.js`, add a `brand-assets` bucket | `brand_assets` |
| `isSuperAdmin()` (`src/lib/admin.js`), `requireRole()` (`src/lib/roles.js`) | Add `requireWorkspaceRole()` alongside — same shape, same file | — |
| `CampaignForm` | Save-as-template, create-from-template | `campaign_templates` |
| `ui/item.jsx`, `ui/empty.jsx`, `ui/avatar.jsx` | Member lists, asset grid empty states | — |

---

## 1. The workspaces migration

### Problem

A campaign belongs to a *person*. `campaigns.brand_id` references `auth.users(id)`, and every brand-side RLS policy in the system compares it against `auth.uid()`.

That single fact blocks the entire agency and enterprise segment:

- A marketing team of five can't share campaigns. They share one login, or they don't use the product.
- An agency managing twelve clients has no way to separate them.
- Nobody can be given limited access — there's no "can review submissions but can't release payments," which is the first thing any finance team asks for.
- When the person who created the campaign leaves the company, the campaign leaves with them.

### Why it must happen in Phase 2

It gets strictly more expensive every phase. Phases 3–5 add roughly eleven tables that reference a brand — `source_assets`, `brand_voice`, `ai_jobs`, `brand_assets`, `campaign_templates`, `subscriptions`, and more. Each one added before the migration is another table to repoint, another set of policies to rewrite, and another chance to miss one.

The cost curve is the argument. It is not that agencies are the Phase 2 priority.

### Migration path

Backward-compatible, in four deploys. No big-bang cutover.

**Deploy 1 — create structures, backfill, don't switch.**

```sql
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  owner_id uuid not null references auth.users(id),
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member','reviewer','billing')),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- One personal workspace per existing brand user, named from their profile
insert into public.workspaces (id, name, owner_id)
select
  gen_random_uuid(),
  coalesce(bp.company_name, p.full_name, 'My workspace'),
  p.id
from public.profiles p
left join public.brand_profiles bp on bp.user_id = p.id
where p.role = 'brand';

insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
select w.id, w.owner_id, 'owner', now() from public.workspaces w;
```

**Deploy 2 — add the nullable column, dual-write.**

```sql
alter table public.campaigns
  add column workspace_id uuid references public.workspaces(id);

update public.campaigns c
set workspace_id = w.id
from public.workspaces w
where w.owner_id = c.brand_id;
```

Application code writes both `brand_id` and `workspace_id`. Reads still use `brand_id`. Nothing user-visible changes.

**Deploy 3 — switch reads, rewrite policies.** Every brand-side policy moves from `brand_id = auth.uid()` to workspace membership:

```sql
create policy "Workspace members can view their campaigns"
  on public.campaigns for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = campaigns.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.accepted_at is not null
    )
  );
```

This is RLS pattern 2, unchanged in shape — just one more join. Every route handler that checks `campaign.brand_id !== user.id` (the fund, verify, approve, and release routes) switches to a shared `assertWorkspaceAccess()` helper.

**Deploy 4 — make it required, drop the old column.**

```sql
alter table public.campaigns alter column workspace_id set not null;
alter table public.campaigns drop column brand_id;
```

Only after deploy 3 has been live and clean for a full release cycle.

### Roles

| Role | Campaigns | Submissions | Payments | Members | Billing |
|---|---|---|---|---|---|
| `owner` | Full | Full | Full | Full | Full |
| `admin` | Full | Full | Full | Invite/remove | View |
| `member` | Create, edit own | Review, request revision | — | — | — |
| `reviewer` | View | Review, comment | — | — | — |
| `billing` | View | — | Fund, release | — | Full |

The separation that matters: **`member` can approve creative work but cannot move money.** That's the control every finance team asks for, and it's the reason a company can put more than one person on the platform.

`profiles.role` stays exactly as it is — the account-type flag distinguishing brand-side from creator-side users. Workspace roles are a second, orthogonal axis, the same way `isSuperAdmin` already is. Three axes total, each with a clear job.

### Edge cases

- **A user in multiple workspaces** needs a workspace switcher in `app-sidebar.jsx` and an active-workspace notion. Store it in a cookie, validate membership server-side on every request — never trust the client's claim about which workspace it's acting in.
- **The last owner leaving** must be blocked. Every workspace keeps at least one owner.
- **Personal workspaces from the backfill** are indistinguishable from team ones by design — a solo brand shouldn't be forced to think about workspaces at all until they invite someone.
- **Clippers don't get workspaces** in this phase. A creator is an individual. Creator collectives are a Phase 5 question.
- **Super admin** bypasses workspace checks exactly as it bypasses `requireRole` today.
- **Invited but not accepted** (`accepted_at is null`) grants nothing. The policies check it explicitly.

---

## 2. Brand kit & asset library

### Problem

Creators guess at brand presentation. Fonts, colours, logo placement, and tone get re-litigated in every revision cycle, which is the most common avoidable revision in short-form work.

Partially seeded already: `brand_profiles.font_name` and `color_code` exist. They're stored and shown nowhere useful.

### User flow

```
Brand fills the kit once (colours, fonts, logos, intro/outro stings, music, guidelines)
  → creator opens a campaign → kit is right there, downloadable
  → AI caption/subtitle generation conditions on the kit (Phase 3)
  → submissions auto-checked against the kit (Phase 3)
```

### UI screens

Brand kit lives as a section on the existing `/brand-profile` page, which is already a sectioned full-page form — the pattern is established, this just adds sections. Colour swatches, font selection, logo variants (light/dark/mark), guideline text.

Asset library at `/workspace/assets`: a grid with type filters, drag-and-drop upload using the unused `ui/attachment.jsx`, per-asset usage rights. Creator-side, the kit appears read-only on the campaign detail page with a "Download kit" action.

### Database schema

```sql
alter table public.brand_profiles
  add column workspace_id uuid references public.workspaces(id) on delete cascade,
  add column colors jsonb default '[]',
  add column fonts jsonb default '[]',
  add column guidelines text,
  add column tone_notes text;

create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  kind text not null check (kind in
    ('logo','font','music','sting','b_roll','template','document','other')),
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  usage_rights text,
  created_at timestamptz not null default now()
);
```

`colors` and `fonts` become JSONB arrays because a brand has a palette, not one hex. Existing `color_code` and `font_name` migrate into them and stay readable during the transition.

### APIs

| Route | Method | Purpose |
|---|---|---|
| `/api/workspace/assets` | `POST` / `DELETE` | Upload, delete |
| `/api/workspace/assets/[id]/signed-url` | `GET` | Time-limited download for an approved creator |

**Signed URLs, not public URLs.** All storage access today uses `getPublicUrl` — fine for avatars, wrong for brand assets. `createSignedUrl` appears nowhere in the codebase yet; this is where it starts.

### Permissions

Assets are workspace-scoped (pattern 2 via `workspace_members`). Creators get read access only to workspaces where they hold an approved application:

```sql
create policy "Approved creators can read brand assets"
  on public.brand_assets for select
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      join public.campaign_applications ca on ca.campaign_id = c.id
      where c.workspace_id = brand_assets.workspace_id
        and ca.clipper_id = (select auth.uid())
        and ca.status = 'approved'
    )
  );
```

Storage bucket policies must mirror this. RLS on the table alone does not protect the object — a common and expensive mistake.

### Edge cases

Licensed fonts and music carry redistribution terms the platform can't verify — `usage_rights` is free text plus an explicit acknowledgement at upload. Access must revoke when an application is un-approved or the campaign ends. Large files need a size cap and background processing. Deleting an asset referenced by an in-flight campaign should soft-delete.

### AI opportunities

Extract a palette and font from an uploaded logo or an existing published video; auto-check submissions for kit compliance; generate a starter kit from the brand's website.

### Future improvements

Versioned kits; per-campaign kit overrides; a public brand page; kit compliance scoring in the creator's quality report.

---

## 3. Approval workflow

### Problem

Once a workspace has multiple members, "approved" becomes ambiguous — a junior marketer approving a submission shouldn't release ₹200,000. Today one person does everything, so the question doesn't arise; the moment teams exist, it's the first blocker.

### User flow

```
Workspace configures a policy:
  submissions over ₹X require N approvals
  payment release always requires a `billing` or `owner` role

Submission arrives → reviewers approve → threshold met
  → moves to payable → billing role releases
```

### Database schema

```sql
create table public.approval_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  submission_approvals_required int not null default 1,
  approval_threshold_amount numeric,
  release_requires_role text not null default 'billing',
  updated_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('submission','payout','campaign')),
  subject_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  approver_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','rejected')),
  note text,
  created_at timestamptz not null default now(),
  unique (subject_type, subject_id, approver_id)
);
```

### Permissions & edge cases

The threshold check belongs in the API route, before the existing Razorpay call — never client-side. `unique (subject_type, subject_id, approver_id)` prevents one person satisfying a two-approval requirement by clicking twice.

Watch for: a policy requiring more approvals than the workspace has members (validate on save); an approver leaving mid-flow (their approval stands, it was valid when given); policy changes mid-flight (evaluate against the policy at submission time, snapshotted).

### Future improvements

Conditional routing by campaign or category; delegated approval during leave; a full audit log surfaced in `/admin`.

---

## 4. Campaign templates

### Problem

Brands run the same campaign shape repeatedly — same brief structure, same payout model, same requirements, different source content. Today every one is retyped into `CampaignForm`.

### User flow

Save any campaign as a template, or start from one. Templates are workspace-scoped, so a team shares them. Platform-provided starter templates by use case (podcast clips, SaaS demo cuts, launch teasers) also solve the empty-state problem for a brand's very first campaign.

### Database schema

```sql
create table public.campaign_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id),
  is_platform_template boolean not null default false,
  name text not null,
  description text,
  payload jsonb not null,
  use_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.campaigns
  add column template_id uuid references public.campaign_templates(id) on delete set null;
```

`payload` is JSONB rather than mirrored columns, so template shape can evolve without a migration each time `campaigns` gains a field.

### Permissions & edge cases

Workspace members read their own templates; `is_platform_template = true` rows are readable by everyone and writable only by super admin (matching the existing `isSuperAdmin` pattern).

Templates carry no budget or funding state — a template that pre-fills money is a mis-click waiting to happen. Stale templates referencing deleted assets should validate at instantiation, not fail silently. `template_id` is kept for attribution so you can measure which templates actually produce funded campaigns.

### AI opportunities

Generate a template from a brand's past three successful campaigns; recommend a template from the uploaded source asset type (Phase 3); suggest brief improvements based on which templates correlate with more applicants.

### Future improvements

Template marketplace with creator-authored briefs; per-industry starter packs; template versioning.
