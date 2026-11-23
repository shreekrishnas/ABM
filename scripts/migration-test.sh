#!/usr/bin/env bash
# Upgrade → check → rollback → check → re-apply test for one migration, on a throwaway local database
# (abm_migtest). Never point it at production. Needs a local Postgres and a shell that can run psql as
# the postgres superuser (to create the database).
#
#   scripts/migration-test.sh client_ownership
#
# For migration <timestamp>_<name> it uses scripts/migration-tests/<name>.{fixtures,up,down}.sql and
# the rollback prisma/rollbacks/<timestamp>_<name>.sql:
#   1. every earlier migration via `prisma migrate deploy` (the path production uses), then fixtures
#   2. the migration itself via `prisma migrate deploy`, then <name>.up.sql (assertions)
#   3. the rollback script, then <name>.down.sql (assertions)
#   4. `prisma migrate deploy` again (the migration re-applies cleanly), then <name>.up.sql again
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=${1:?usage: scripts/migration-test.sh <migration name, e.g. client_ownership>}
DIR=$(ls -d prisma/migrations/*_"$NAME" 2>/dev/null | head -1)
[ -n "$DIR" ] || { echo "no migration named *_$NAME"; exit 1; }
MIG=$(basename "$DIR")
T=scripts/migration-tests/$NAME
DB=abm_migtest
PG="postgresql://abm:abm@localhost:5432/$DB"
export DATABASE_URL="$PG?schema=public"
sql() { psql "$PG" -q -X -v ON_ERROR_STOP=1 "$@"; }
super() { if [ "$(id -un)" = postgres ]; then psql -q -X -v ON_ERROR_STOP=1 "$@"; else runuser -u postgres -- psql -q -X -v ON_ERROR_STOP=1 "$@"; fi; }
step() { echo "── $*"; }

step "fresh database $DB"
super -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER abm" >/dev/null

step "earlier migrations (before $MIG) with prisma migrate deploy"
TMP=$(mktemp -d)
mkdir -p "$TMP/prisma/migrations"
cp prisma/schema.prisma "$TMP/prisma/"
cp prisma/migrations/migration_lock.toml "$TMP/prisma/migrations/"
for d in prisma/migrations/*/; do n=$(basename "$d"); [[ "$n" < "$MIG" ]] && cp -r "$d" "$TMP/prisma/migrations/"; done
npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma" >/dev/null
echo "   applied $(sql -tA -c 'select count(*) from "_prisma_migrations"') migrations"

step "fixtures (production-like rows)"
sql -f "$T.fixtures.sql"

step "upgrade: $MIG with prisma migrate deploy"
npx prisma migrate deploy >/dev/null
sql -f "$T.up.sql"
echo "   upgrade checks passed"

if [ -f "$T.refuse.sql" ]; then
  step "rollback refuses an unsafe state ($T.refuse.sql) and changes nothing"
  sql -f "$T.refuse.sql"
  if sql -f "prisma/rollbacks/$MIG.sql" 2>/dev/null; then echo "   FAIL: the rollback ran"; exit 1; fi
  sql -f "$T.up.sql" >/dev/null 2>&1 || true
  sql -f "$T.unrefuse.sql"
  sql -f "$T.up.sql"
  echo "   refused, database unchanged"
fi

step "rollback: prisma/rollbacks/$MIG.sql"
sql -f "prisma/rollbacks/$MIG.sql"
sql -f "$T.down.sql"
echo "   rollback checks passed"

step "re-apply after rollback"
npx prisma migrate deploy >/dev/null
sql -f "$T.up.sql"
echo "   re-apply checks passed"

super -c "DROP DATABASE IF EXISTS $DB" >/dev/null
rm -rf "$TMP"
echo "OK: $MIG upgrades, rolls back and re-applies cleanly"
