# Clipper

A marketplace connecting **brands** and **clippers** (YouTube creators). Brands post campaigns and fund them via Razorpay; clippers connect a YouTube channel, apply to campaigns, submit clips, and get paid once approved.

## Tech stack

- **Next.js 16** (App Router) — note: `proxy.js`, not `middleware.ts` (renamed in this version)
- **React 19**, **Tailwind CSS v4**
- **shadcn/ui** on **base-ui** (not Radix) — composition uses the `render` prop, not `asChild`
- **Supabase** — Postgres, Auth (Google OAuth only), Storage
- **Razorpay Route** — campaign funding, held transfers, payout release (not Razorpay's separate "Escrow" product)

See `AGENTS.md` for the full set of project-specific conventions, RLS patterns, and known gaps.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

Create `.env.local` with:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=             # sb_secret_... — required for /admin and payout routes (server-only, never NEXT_PUBLIC_)

# Google OAuth — used for both "Sign in with Google" and the YouTube connector
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Razorpay Route — real API calls 401 until these are real (test or live) keys
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=     # same value as RAZORPAY_KEY_ID, exposed for Razorpay Checkout.js
RAZORPAY_WEBHOOK_SECRET=        # verifies incoming webhook payloads (/api/payments/webhook)

# Super admin — hardcoded owner account, not a DB role
SUPER_ADMIN_EMAIL=
```

### Database

`supabase/` is committed — `config.toml`, 21 migrations, `seed.sql`, and the RLS suite in `tests/`. Develop against the local stack, not the live project (ref `nfeuykwnqqtdecwucujo`).

```bash
brew install --cask orbstack   # or Docker Desktop — local stack needs a container runtime
supabase login
supabase link --project-ref nfeuykwnqqtdecwucujo
supabase start                 # local Postgres/Auth/Storage/Studio
supabase db reset              # replays every migration, then runs seed.sql
```

`.env.development.local` already points the app at the local stack and Next.js gives it precedence over `.env.local` in dev — so **`npm run dev` needs OrbStack running**, or every page renders empty with no error to explain why.

New schema changes go through `supabase migration new <name>`, tested locally with `supabase db reset` and `npm run verify`, then `supabase db push`. Migration filenames must match the version the database records — see `supabase/migrations/README.md`.

### Verification

`.env*` is gitignored, so a fresh clone has no `DATABASE_URL` and `test:rls` will exit 2 with instructions. Add it once:

```bash
echo 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres' >> .env.development.local
```

```bash
npm run verify     # lint -> build -> test:rls
```

`npm run test:rls` runs the RLS suite against `DATABASE_URL` inside a transaction that rolls back. FAIL and SKIP both fail the run; a SKIP means the fixture was missing and nothing was asserted.

## Route map

**Public** (`src/app/(app)/`)
- `/` — marketing home page
- `/login` — Google sign-in
- `/privacy`, `/terms`, `/clipper-terms`, `/faq`, `/support` (`src/app/(legal)/`)

**Protected app** (`src/app/(protected)/`) — role-branched sidebar, see `AGENTS.md` for exactly which routes are role-gated at the route level vs. just nav-hidden
- Clipper: `/dashboard`, `/connectors` (YouTube), `/analytics`, `/clipper-profile`, `/payout-account`
- Brand: `/campaigns` (also the clipper's campaign-browse view), `/clippers` (directory), `/brand-profile`
- Everyone: `/profile` (name/avatar/role switch)
- Super admin only: `/admin`

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — ESLint
