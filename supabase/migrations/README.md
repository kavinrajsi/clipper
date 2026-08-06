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

## Local and remote are fully in step (2026-08-01)

`supabase migration list` now pairs every version on both sides. Two things got it there.

**`20260731191104_local_parity_avatars_and_signup_trigger.sql`.** `supabase db diff --linked` found three things the live project had that no migration created, because they were made through the dashboard: the `avatars` bucket, its three `storage.objects` policies, and the `on_auth_user_created` trigger. A fresh `db reset` therefore produced a database that did not match production, and every RLS assertion run against it was testing the wrong schema. The migration adds what production already had, is idempotent (verified by running it three times against local), and has been pushed.

**Three stub files, for the versions listed below.** They are intentionally empty — see the next section.

## Three entries in the database whose SQL lives in another file

| Recorded version | Name | Where its SQL lives now |
|---|---|---|
| `20260726185437` | `fix_invite_policy_recursion` | folded into `20260726185312_campaign_visibility_and_invites.sql` |
| `20260726213828` | `workspace_invitee_can_read_name` | folded into `20260726213652_workspace_invites.sql` |
| `20260726214154` | `workspace_invitee_accept` | folded into `20260726213652_workspace_invites.sql` |

These were follow-up fixes applied minutes after the migration they corrected,
while it was still being written. Rather than leave three near-empty files, the
SQL was folded into the file it belongs to.

**That folding had a third consequence this file used to call harmless, and it
was not: `supabase db push` was permanently blocked.** The CLI refuses to push
anything at all while a remote version has no local file, and the fix it
suggests —

    supabase migration repair --status reverted 20260726185437 20260726213828 20260726214154

— deletes those ledger rows, which is exactly what the paragraph below says not
to do. So each version now has an intentionally empty file whose comment points
at where its SQL actually lives. The ledger is untouched, the history is intact,
and `db push` works.

Remaining consequences, both genuinely harmless:

- A fresh `db reset` applies the three empty files as no-ops, at the same point
  in the sequence. Their SQL still arrives as part of the consolidated file, and
  the end state is identical — verified: 39 tables, 3 avatar policies, the
  signup trigger, and 43 passing RLS checks after a reset.
- `supabase migration list` pairs every version on both sides.

Do not delete these rows to "tidy up" — they are the real history of what ran
against production. Empty files are the cheaper price.

## Testing policies

`supabase/tests/rls.sql` is the regression suite. It impersonates real users and
runs the queries the app runs, inside a transaction that rolls back. Run it after
any policy change:

```bash
npm run test:rls
```

Every row should read PASS. See `AGENTS.md` for the policy-cycle rule that suite
exists to enforce.
