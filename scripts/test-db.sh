#!/usr/bin/env bash
# Runs the database tests against a throwaway local Postgres. Usage: scripts/test-db.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
if [ -n "${DATABASE_URL:-}" ]; then PSQL="psql $DATABASE_URL"; else
  TMP="$(mktemp -d)"; "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p 54329 -k $TMP" -l "$TMP/log" start >/dev/null
  trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop >/dev/null; rm -rf "$TMP"' EXIT
  PSQL="psql -h $TMP -p 54329 -U postgres -d postgres"
fi
$PSQL -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
$PSQL -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql" >/dev/null
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do echo "== $(basename "$f")"; $PSQL -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -oE "(ok - .*|FAIL: .*|ERROR: .*)" ; test ${PIPESTATUS[0]} -eq 0 || exit 1; done
echo "All database tests passed"
