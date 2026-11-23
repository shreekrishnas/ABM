#!/usr/bin/env bash
# Tests the PRODUCTION procedure for one migration on a throwaway local database (abm_payload_<name>):
# the app's schema "abm", every earlier migration in place, production-like rows, then the SQL that
# scripts/supabase-migration-sql.sh prints, applied as one batch in one transaction (the way one
# Supabase apply_migration call sends it). Never point it at production. Needs a local Postgres and a
# shell that can run psql as the postgres superuser (to create the database).
#
#   scripts/migration-payload-test.sh 20261123100000_client_ownership
#
# Uses scripts/migration-tests/<name>.{fixtures,up,down}.sql (and .refuse/.unrefuse when present), like
# scripts/migration-test.sh, which tests the same migration through `prisma migrate deploy`.
set -euo pipefail
MIG="${1:?migration folder name, e.g. 20261123100000_client_ownership}"
NAME="${MIG#*_}"
T="scripts/migration-tests/$NAME"
DB="abm_payload_$NAME"
URL="postgresql://abm:abm@localhost:5432/$DB"
[ -f "prisma/migrations/$MIG/migration.sql" ] || { echo "No such migration: $MIG"; exit 1; }
[ -f "$T.fixtures.sql" ] || { echo "Missing $T.fixtures.sql"; exit 1; }
super() { if [ "$(id -un)" = postgres ]; then psql -q -X -v ON_ERROR_STOP=1 "$@"; else runuser -u postgres -- psql -q -X -v ON_ERROR_STOP=1 "$@"; fi; }
sql() { PGOPTIONS='-c search_path=abm' psql "$URL" -q -X -v ON_ERROR_STOP=1 "$@"; }
batch() { psql "$URL" -q -X -v ON_ERROR_STOP=1 -1 "$@"; } # one transaction, like one apply_migration call
recorded() { sql -tAc "select count(*) from \"_prisma_migrations\" where migration_name = '$MIG'"; }
step() { echo "── $*"; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; super -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true' EXIT

step "fresh database $DB; earlier migrations into schema abm"
super -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER abm" >/dev/null
mkdir -p "$TMP/prisma/migrations"
cp prisma/schema.prisma "$TMP/prisma/"
cp prisma/migrations/migration_lock.toml "$TMP/prisma/migrations/"
for d in prisma/migrations/*/; do n=$(basename "$d"); [[ "$n" < "$MIG" ]] && cp -r "$d" "$TMP/prisma/migrations/"; done
DATABASE_URL="$URL?schema=abm" npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma" >/dev/null
echo "   $(sql -tAc 'select count(*) from "_prisma_migrations"') earlier migrations"

step "production-like rows"
sql -f "$T.fixtures.sql"
scripts/supabase-migration-sql.sh "$MIG" > "$TMP/apply.sql"
scripts/supabase-migration-sql.sh "$MIG" --rollback > "$TMP/rollback.sql"

step "apply: the Supabase payload as one batch"
batch -f "$TMP/apply.sql"
sql -f "$T.up.sql"
echo "   upgrade checks passed; recorded in _prisma_migrations: $(recorded)"

step "the same payload again: refused as a whole or harmless, never half-applied"
if batch -f "$TMP/apply.sql" >/dev/null 2>&1; then second="ran again harmlessly"; else second="refused as a whole"; fi
sql -f "$T.up.sql"
[ "$(recorded)" = 1 ] || { echo "   FAIL: recorded $(recorded) times"; exit 1; }
echo "   $second; still upgraded; recorded: $(recorded)"

if [ -f "$T.refuse.sql" ]; then
  step "rollback refuses an unsafe state and changes nothing"
  sql -f "$T.refuse.sql"
  if batch -f "$TMP/rollback.sql" >/dev/null 2>&1; then echo "   FAIL: the rollback ran"; exit 1; fi
  sql -f "$T.unrefuse.sql"
  sql -f "$T.up.sql"
  echo "   refused; database unchanged; recorded: $(recorded)"
fi

step "rollback: the rollback payload as one batch"
batch -f "$TMP/rollback.sql"
sql -f "$T.down.sql"
echo "   rollback checks passed; recorded: $(recorded)"

step "rollback again (safe to repeat)"
batch -f "$TMP/rollback.sql"
sql -f "$T.down.sql"
echo "   repeated cleanly"

step "re-apply"
batch -f "$TMP/apply.sql"
sql -f "$T.up.sql"
echo "   re-apply checks passed; recorded: $(recorded)"
echo "OK: $MIG through the Supabase payload in schema abm: applies, a second apply is refused or harmless, rolls back (repeatably), re-applies"
