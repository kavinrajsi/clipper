# Migrations

## Filenames match what the database recorded

Every file here is named `<version>_<name>.sql` where `<version>` is exactly the
version in `supabase_migrations.schema_migrations` on the live project.

That matters because most of these were applied through the Supabase MCP
`apply_migration` tool, which generates its own timestamp at apply time. The
filenames originally used hand-written timestamps, so **every migration looked
unapplied to the CLI** — `supabase db push` would have tried to re-run all of
them. Several are not idempotent (the workspaces backfill inserts,
`alter publication supabase_realtime add table`), so that would have failed
partway.

The files were renamed to the recorded versions on 2026-07-27. `db push` is now
a no-op against the live project, and `db reset` replays them in exactly the
order they were originally applied.

**Adding a migration from here on:** if you apply it via MCP, name the file with
the version the tool records. If you use `supabase migration new`, the CLI picks
the version and applying it via the CLI keeps both sides in step. Mixing the two
without matching versions is what caused this.

## Three entries exist in the database with no file here

| Recorded version | Name | Where its SQL lives now |
|---|---|---|
| `20260726185437` | `fix_invite_policy_recursion` | folded into `20260726185312_campaign_visibility_and_invites.sql` |
| `20260726213828` | `workspace_invitee_can_read_name` | folded into `20260726213652_workspace_invites.sql` |
| `20260726214154` | `workspace_invitee_accept` | folded into `20260726213652_workspace_invites.sql` |

These were follow-up fixes applied minutes after the migration they corrected,
while it was still being written. Rather than leave three near-empty files, the
SQL was folded into the file it belongs to.

Consequences, both harmless:

- `supabase migration list` shows them as remote-only. Expected, not drift.
- A fresh `db reset` applies their SQL as part of the consolidated file, at the
  same point in the sequence. The end state is identical.

Do not delete these rows to "tidy up" — they are the real history of what ran
against production.

## Testing policies

`supabase/tests/rls.sql` is the regression suite. It impersonates real users and
runs the queries the app runs, inside a transaction that rolls back. Run it after
any policy change:

```bash
npm run test:rls
```

Every row should read PASS. See `AGENTS.md` for the policy-cycle rule that suite
exists to enforce.
