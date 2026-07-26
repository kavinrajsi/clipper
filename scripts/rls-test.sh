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
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -f .env.local ]; then
  DB_URL=$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' .env.local 2>/dev/null \
           | tail -1 | sed -E "s/^[^=]*=//; s/^[\"']//; s/[\"']$//")
fi

if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  echo "Running $SQL"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL"
  exit $?
fi

cat <<EOF
No DATABASE_URL (or no psql), so this cannot run the suite for you.

Run it either way:

  1. Supabase dashboard -> SQL editor -> paste $SQL and run.
  2. Or set a direct connection string and re-run:
       DATABASE_URL='postgresql://...' npm run test:rls

Every row of the output should read PASS. Any FAIL is a real policy defect.
The whole suite rolls back, so it is safe against production.
EOF
exit 2
