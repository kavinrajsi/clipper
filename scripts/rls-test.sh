#!/usr/bin/env bash
#
# Run the RLS regression suite (supabase/tests/rls.sql).
#
#   npm run test:rls
#
# The suite impersonates real brand and clipper users and runs the queries the
# app actually runs, inside a transaction that ROLLS BACK. Nothing persists.
#
# It exists because two RLS bugs reached production that schema inspection
# could not catch — a 42P17 policy recursion, and a visibility column added
# without amending the policies that enforce it. Reading pg_policies passed in
# both cases; running a query as a real user is what catches them.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SQL="supabase/tests/rls.sql"
[ -f "$SQL" ] || { echo "missing $SQL"; exit 1; }

# DATABASE_URL is not part of the app's normal env — the app talks to PostgREST,
# not Postgres directly. Supply it only to run this locally.
# Both files are read, .env.development.local last so it wins: it is the one
# that describes the local stack, and .env.local is rewritten by `vercel env
# pull`. razorpay-probe.sh already reads both; this used to read only .env.local.
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ]; then
  for f in .env.local .env.development.local; do
    [ -f "$f" ] || continue
    v=$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$f" 2>/dev/null \
        | tail -1 | sed -E "s/^[^=]*=//; s/^[\"']//; s/[\"']\$//")
    [ -n "$v" ] && DB_URL="$v"
  done
fi

if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  echo "Running $SQL"

  # The suite reports by SELECTing a result table, so every outcome — PASS,
  # FAIL, SKIP, NOTE — is a successful query as far as psql is concerned. psql
  # exits 0 on a wall of FAIL rows. `exit $?` therefore gated nothing: this
  # script could not fail a build. The verdict has to be read out of the rows.
  OUT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -P pager=off -f "$SQL" 2>&1)
  PSQL_STATUS=$?
  echo "$OUT"

  # A SQL error (bad syntax, missing table) is its own failure, ahead of any row.
  [ "$PSQL_STATUS" -eq 0 ] || exit "$PSQL_STATUS"

  # SKIP is a failure, not a pass. The suite returns a single SKIP row and stops
  # when it cannot find a brand profile, a clipper profile, or the brand's
  # workspace — so an unseeded database produced an all-SKIP run that looked
  # green while asserting nothing. `supabase/seed.sql` supplies those rows
  # locally. NOTE is informational and stays allowed.
  BAD=$(echo "$OUT" | grep -cE '\|[[:space:]]*(FAIL|SKIP)') || true
  PASSES=$(echo "$OUT" | grep -cE '\|[[:space:]]*PASS') || true

  if [ "$BAD" -gt 0 ]; then
    echo
    echo "$BAD failing or skipped check(s):"
    echo "$OUT" | grep -E '\|[[:space:]]*(FAIL|SKIP)'
    exit 1
  fi

  # Zero rows of any kind means the suite did not run, which must not read as
  # success either.
  if [ "$PASSES" -eq 0 ]; then
    echo
    echo "No PASS rows — the suite produced no assertions."
    exit 1
  fi

  echo
  echo "$PASSES checks passed."
  exit 0
fi

cat <<EOF
No DATABASE_URL (or no psql), so this cannot run the suite for you.

Run it either way:

  1. Local stack (the normal path):
       supabase start && supabase db reset
       DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' npm run test:rls
  2. Supabase dashboard -> SQL editor -> paste $SQL and run.
  3. Or any other direct connection string:
       DATABASE_URL='postgresql://...' npm run test:rls

Every row should read PASS, or NOTE where the suite is explaining a fixture.
A FAIL is a real policy defect. A SKIP means the database had no brand/clipper
fixture, so the suite asserted nothing — treat it as a failure, not a pass.
The whole suite rolls back, so it is safe against production.
EOF
exit 2
