# Supabase — local dev setup

Standing up a local Supabase stack.

> ## ⚠ `npm run dev` points at LOCAL, not the live project
>
> Both env files set `NEXT_PUBLIC_SUPABASE_URL`:
>
> | File | Value |
> |---|---|
> | `.env.local` | `https://nfeuykwnqqtdecwucujo.supabase.co` (live) |
> | `.env.development.local` | `http://127.0.0.1:54321` (local stack) |
>
> **Next.js gives `.env.development.local` precedence in development**, so `npm run dev` always talks to the local stack. If OrbStack isn't running and `supabase start` hasn't been run, the app has **no database at all** — every page that reads data silently renders empty or 404s, with no error to explain why. Static pages still work, which makes it look like the app is fine.
>
> Symptom: a page that should show data returns 404, and a direct `curl` to `127.0.0.1:54321` gives `Connection refused`.
>
> Either start the local stack (below), or run against live for one session without editing any file — real shell env vars beat `.env` files:
>
> ```bash
> set -a; . ./.env.local; set +a; npm run dev
> ```
>
> **A local stack needs the migrations applied too.** `supabase/migrations/` is committed, so `supabase db reset` (or `supabase start` on a fresh volume) replays them. Schema changes pushed straight to the live project via the dashboard or MCP will not be in local until you also add the migration file — which is why every schema change should land as a file in `supabase/migrations/`.

> **Updated 2026-08-01:** `supabase/` is committed — `config.toml`, **21 migrations**, `seed.sql`, and `tests/rls.sql`. The live project (ref `nfeuykwnqqtdecwucujo`, name "Clipping") is no longer the only source of truth for the schema. The `supabase init` / `db pull` steps below are therefore first-time-setup history; if you're cloning fresh, you only need `supabase link`, `supabase start`, and `supabase db reset` (which replays the migrations and then runs `seed.sql`, without which the RLS suite has no fixture and asserts nothing).

## Prerequisites

Local stack runs in containers — need a runtime:

```bash
brew install --cask orbstack   # lighter than Docker Desktop, drop-in compatible
```

Open OrbStack once after install to finish setup.

## Setup

```bash
supabase login
supabase init
supabase link --project-ref nfeuykwnqqtdecwucujo
supabase db pull      # pulls remote schema down as supabase/migrations/
supabase start        # local Postgres/Auth/Storage/Studio
```

`supabase start` prints:
- local API URL (`http://127.0.0.1:54321`)
- local `anon`/`publishable` key
- local `service_role`/`secret` key
- Studio URL (`http://127.0.0.1:54323`)

Use those in a separate env file for local dev — don't overwrite the prod values in `.env.local`.

## Google OAuth for local

Local Supabase needs its own redirect URI registered in the Google Cloud OAuth client, alongside the prod one:

```
http://127.0.0.1:54321/auth/v1/callback
```

This is separate from the YouTube connector's own OAuth client (`src/lib/youtube.js`) — see `AGENTS.md` → "Auth and roles".

## What gets committed

Once `supabase/` exists:
- **Commit**: `supabase/migrations/`, `supabase/config.toml`
- **Don't commit** (already in `.gitignore`): `supabase/.branches`, `supabase/.temp`, `supabase/.env`

## Ongoing schema changes (once local is set up)

Prefer this over hand-editing the live project directly:

```bash
supabase migration new <name>
# edit the generated SQL file
supabase db push      # apply to linked remote project
# or: supabase db reset  (apply to local stack only)
```

Run `supabase db advisors` (or MCP `get_advisors`) after any RLS/policy change.
