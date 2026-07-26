# Design System

**This is not a rebrand.** The development rules for this project are explicit: reuse existing colours, typography, spacing, and icons; do not introduce a different design language. Clipper has a working visual system — oklch tokens in `globals.css`, Geist, lucide icons, base-ui composition via the `base-nova` shadcn style. All of it stays.

What follows is the gap between the system that's *defined* and the system that's *used*. Almost every item is adopting something already written and sitting unused.

## The honest summary

| Layer | Defined | Actually used |
|---|---|---|
| Colour tokens (oklch, light + dark) | Complete | Light only — dark mode isn't reachable |
| Typography (Geist sans + mono) | Complete | Yes |
| Primitives in `ui/` | 57 files | 41 unused |
| Toast infrastructure | Mounted | **Zero `toast()` calls** |
| Empty states | `ui/empty.jsx` complete | Zero imports — 3 ad-hoc `<p>` instead |
| Skeletons | `ui/skeleton.jsx` complete | Zero imports |
| Route loading / error boundaries | — | **None anywhere** |
| Formatters | — | Duplicated across 12 files |

Nothing here needs a new dependency. Every fix is wiring something that already exists.

---

## 1. Mount the theme provider

`next-themes` is installed. `src/components/ui/sonner.jsx:3` calls `useTheme()`. **No `ThemeProvider` is mounted in either layout**, so that call permanently falls back to its default and dark mode is unreachable — despite a complete `.dark` oklch palette existing in `globals.css`.

Add the provider at `src/app/layout.js`, wrapping the existing `TooltipProvider`, with `attribute="class"` to match the `@custom-variant dark (&:is(.dark *))` already defined in the stylesheet. Add a theme toggle to `NavUser`.

Half a day, and it turns an entire already-written palette on.

## 2. Pick one toast stack, then use it

Two competing implementations exist:

- `ui/sonner.jsx` — the `sonner` library, `<Toaster/>` **mounted** at `src/app/(protected)/layout.js:5`
- `ui/toast.jsx` — `@base-ui/react/toast`, with its own provider and `createToastManager()`, **not mounted**

And `toast()` is never called anywhere in the application. Every success and failure in the product is an inline `<Alert>` scoped to one form.

**Recommendation: keep sonner, delete `ui/toast.jsx`.** Sonner is already mounted, and shipping two toast systems guarantees they diverge.

Then move `<Toaster/>` to the root layout — public pages need feedback too once `/c/[handle]` and the save/follow actions from [`01-marketplace.md`](./01-marketplace.md) exist.

**When to toast vs. when to alert:**

| Situation | Pattern |
|---|---|
| Action succeeded, user stays on the page | Toast |
| Action succeeded, user navigates away | Toast |
| Form validation failed | Inline `Alert` — keep it next to the field |
| Action failed and is retryable | Toast with a retry action |
| Something happened because of someone else | Toast |
| Persistent state (payout account under review) | Inline `Alert` — it isn't transient |

Note the current success alerts are sticky and never clear (`profile-form.jsx:127`, `brand-profile-form.jsx:105`, `clipper-profile-form.jsx:109`, `payout-account-form.jsx:116`). Those are exactly the four cases that should be toasts.

## 3. Adopt `ui/empty.jsx`

Three empty states exist, all the same bare one-liner:

- `campaign-applications-list.jsx:107` — "No applications yet."
- `activity-feed.jsx:39` — "No activity synced yet."
- `clippers/page.js:50` — "No clipper profiles yet."

`ui/empty.jsx` is fully implemented — cva-based, dashed border, centred column with `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription` — and imported by nothing.

An empty screen is an invitation to act, not a status report. Each one gets an icon, a title, one line of explanation, and a primary action:

```
        ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                   [icon]
        │  No applications yet       │
           Share your campaign to
        │  reach more creators.      │
              [Invite creators]
        └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

Discovery, saved items, messages, and notifications all need one from the start — a new user meets more empty states than populated ones, and they're the entire first impression.

## 4. Add loading and error boundaries

There is no `loading.js`, `error.js`, or `not-found.js` anywhere under `src/app`. Every page is an all-or-nothing server render, and a thrown error in any Server Component hits the default Next.js error page.

`ui/skeleton.jsx` is written and imported by zero components.

Per route group:

- **`loading.js`** — skeletons matching the real layout. Card grids get card skeletons, tables get row skeletons. Never a centred spinner for a full page; it reads as slower than it is.
- **`error.js`** — what failed, and a retry. In the interface's voice, not an apology, and never a raw stack trace.
- **`not-found.js`** — needed the moment `/c/[handle]` exists, since a wrong handle is a 404 by design.

The in-button `<Spinner/>` convention is good and consistent across 10 files — keep it for actions. Skeletons are for initial page load; spinners are for actions. The per-row `loadingId` pattern in `campaign-applications-list.jsx:136` is the right model for any list with row actions and should be copied.

## 5. Extract `lib/format.js`

`src/lib/utils.js` contains only `cn()`. Formatting is duplicated across the codebase:

| Helper | Copies | Notes |
|---|---|---|
| `formatDate` | 6 | Three admin copies are byte-identical apart from the null fallback string |
| `formatRate` | 4 | Same flat-fee / per-view branch each time |
| `formatNumber` | 2 | Identical |
| `formatAmount` | 1 | INR currency |
| Inline `Intl.NumberFormat` | ~9 | Bypass even the local helpers |
| Inline `toLocaleDateString` | ~5 | |

There was also a **locale split** — and it's narrower than it first looked. Verified: **currency is `en-IN` in all six call sites already.** The only inconsistency was on raw view/engagement counts: `en-US` in `dashboard-summary-cards`, `analytics-summary-cards`, and `video-analytics-table`, versus `en-IN` in `admin-clippers-table`.

The resolution is the opposite of what this doc originally claimed. `en-IN` renders a view count as `4,20,000` (lakh grouping); YouTube and every analytics tool render `420,000`. **The analytics surfaces were right and `admin-clippers-table` was the outlier.** So: money and dates `en-IN`, counts `en-US` grouping.

```js
// src/lib/format.js
export function formatDate(value, { fallback = "—" } = {})
export function formatDateTime(value, { fallback = "—" } = {})
export function formatCurrency(amount, { fallback = "—" } = {})
export function formatNumber(value)
export function formatCompactNumber(value)   // 4.2k — needed for follower counts
export function formatRate(entity)           // flat fee vs per-1,000-views
export function formatRelativeTime(value)    // "2 hours ago" — needed for chat and notifications
```

`date-fns@4.4.0` is already installed and imported **zero times** in `src/`. Use it for the relative-time formatting rather than hand-rolling.

Highest value per line of any change in the roadmap, and it's a pure refactor with no behaviour change.

## 6. Converge tables on TanStack

`@tanstack/react-table` is a dependency, used in exactly one file — `video-analytics-table.jsx`, which has sorting and pagination. The other five tables (`admin-clippers-table`, `admin-brands-table`, `admin-campaigns-table`, `admin-payouts-table`, `my-applications-table`) are hand-rolled `<Table>` markup with no sorting, filtering, or pagination, and each repeats its own `DetailRow` helper and formatters.

New tables — proposal comparison, member lists, published posts — should use the TanStack pattern from day one. Retrofitting the existing five is optional cleanup; establishing the convention for new work is not.

## 7. Ship the command palette

`ui/command.jsx`, `ui/combobox.jsx`, `ui/kbd.jsx`, and the `cmdk` dependency are all present and entirely unused. A ⌘K palette over creators, campaigns, and navigation is close to free and is a genuine power-user affordance for a product where brands search a lot.

---

## Writing conventions

Words are interface, not decoration. The existing copy is decent; these keep it consistent as surface area grows.

- **Name things by what the user controls.** "Payout account," not "Razorpay linked account." "Connect your channel," not "OAuth integration."
- **An action keeps its name through the whole flow.** A button that says "Release payment" produces a toast that says "Payment released." Never "Submit" — say what happens.
- **Errors explain and instruct.** Not "An error occurred." → "This campaign's remaining budget is ₹12,000. Lower the payout or add funds." No apologies, never vague.
- **Sentence case everywhere**, including buttons and headings. Matches what's already there.
- **Currency always carries its symbol**, dates always day-first (`en-IN`), and every synced number states its "as of" time. Fresh-looking stale data is a support ticket.
- **One job per element.** A label labels, a description explains, a placeholder demonstrates. No element quietly doing two.

---

## What deliberately stays unchanged

- **oklch colour tokens** in `globals.css`, both `:root` and `.dark`. Complete, coherent, and shadcn-standard.
- **Geist sans + mono** via `next/font`.
- **lucide-react** icons, per `components.json`.
- **base-ui composition** — the `render` prop and `nativeButton={false}`, never Radix's `asChild`.
- **`Field` / `FieldSet` / `FieldLegend` form structure** — consistent across all four standalone forms and genuinely good.
- **`mx-auto w-full max-w-3xl` page centring** for form pages.
- **Container queries** — `@container/main`, `@container/card`, `@[250px]/card:text-3xl`, `@container/field-group`. Correct instinct, already applied well.
- **Tailwind v4 CSS-first config.** No `tailwind.config.js`; tokens live in `@theme inline`.

---

## Phase 1 checklist

> **Status:** items 1–3 and 5 are done (commits `bde9ed0`, `d6f5f7e`). `lib/format.js` exists, `ThemeProvider` is mounted, `ui/toast.jsx` is deleted, `<Toaster/>` is at the root, and the four sticky success alerts are toasts. Remaining: `ui/empty.jsx` adoption, skeletons + `loading.js`/`error.js`, `not-found.js`, and the command palette.


Ordered by value per hour. All of it is wiring existing code.

1. `lib/format.js` + replace 12 files' worth of duplicate formatters
2. Mount `ThemeProvider`, add the theme toggle
3. Delete `ui/toast.jsx`, move `<Toaster/>` to root, replace the 4 sticky success alerts with toasts
4. Adopt `ui/empty.jsx` for the 3 existing empty states + every new surface
5. `loading.js` + `error.js` per route group, using `ui/skeleton.jsx`
6. `not-found.js` for `/c/[handle]`
7. Command palette with the vendored `cmdk` stack
