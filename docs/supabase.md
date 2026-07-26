# Supabase — local dev setup

Standing up a local Supabase stack.

> **Updated 2026-07-26:** `supabase/` now exists and is committed — `supabase/config.toml` plus two migrations in `supabase/migrations/`. The live project (ref `nfeuykwnqqtdecwucujo`, name "Clipping") is no longer the only source of truth for the schema. The `supabase init` / `db pull` steps below are therefore first-time-setup history; if you're cloning fresh, you only need `supabase link` and `supabase start`.

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
