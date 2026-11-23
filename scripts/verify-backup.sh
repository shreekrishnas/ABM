#!/usr/bin/env bash
# Restores a backup made by scripts/backup-abm.sh into a NEW, isolated database on a LOCAL PostgreSQL server
# and checks it against the live database at backup time:
#   - every table, with the same number of rows (<dump>.counts);
#   - the same tables, indexes and foreign keys (<dump>.schema), every foreign key valid.
# It creates and drops its own database (abm_restore_check_<time>) and never touches production.
#
#   VERIFY_DB_URL='postgresql://postgres@localhost:5432/postgres' scripts/verify-backup.sh backups/abm-<time>.dump
#
# Needs pg_restore and psql 17 or newer, and a local PostgreSQL server at least as new as the backup's
# (17 for production), for example `brew services start postgresql@17`, Postgres.app, or Docker:
#   docker run --rm -d --name abm-verify -p 54317:5432 -e POSTGRES_PASSWORD=verify postgres:17
#   VERIFY_DB_URL='postgresql://postgres:verify@localhost:54317/postgres' scripts/verify-backup.sh backups/abm-<time>.dump
# KEEP=1 keeps the restored database for a look around.
set -euo pipefail
dump="${1:?path to a .dump made by scripts/backup-abm.sh}"
: "${VERIFY_DB_URL:?Set VERIFY_DB_URL to an admin connection on a LOCAL PostgreSQL server}"
SCHEMA="${ABM_SCHEMA:-abm}"
for f in "$dump" "$dump.counts" "$dump.schema"; do [ -f "$f" ] || { echo "Missing $f (make the backup with scripts/backup-abm.sh)"; exit 1; }; done
host=$(printf '%s' "$VERIFY_DB_URL" | sed -E 's#^[a-z]+://([^@/]*@)?(\[[^]]*\]|[^:/?]*).*#\2#')
case "$host" in localhost|127.0.0.1|"[::1]"|"") ;; *) echo "VERIFY_DB_URL must point at a local server (got '$host'). Never verify against production."; exit 1 ;; esac
for t in pg_restore psql; do command -v "$t" >/dev/null || { echo "$t not found: install the PostgreSQL client tools (17 or newer)."; exit 1; }; done
export PGSSLMODE="${VERIFY_SSLMODE:-prefer}"

if [ -f "$dump.sha256" ]; then
  (cd "$(dirname "$dump")" && { sha256sum -c "$(basename "$dump").sha256" >/dev/null 2>&1 || shasum -a 256 -c "$(basename "$dump").sha256" >/dev/null 2>&1; }) || { echo "Checksum FAILED: the file changed since the backup."; exit 1; }
  echo "Checksum: OK"
fi
from_major=$(pg_restore -l "$dump" | sed -nE 's/^;[[:space:]]*Dumped from database version: ([0-9]+).*/\1/p' | head -1)
server_major=$(( $(psql "$VERIFY_DB_URL" -XAtc "show server_version_num") / 10000 ))
if [ -n "$from_major" ] && [ "$server_major" -lt "$from_major" ]; then
  echo "The local server is PostgreSQL $server_major; the backup comes from $from_major. Use a $from_major (or newer) server."
  exit 1
fi

db="abm_restore_check_$(date -u +%Y%m%d%H%M%S)"
target=$(printf '%s' "$VERIFY_DB_URL" | sed -E "s#^([a-z]+://[^/?]*)/[^?]*#\1/$db#")
[ "$target" != "$VERIFY_DB_URL" ] || { echo "VERIFY_DB_URL needs a database name, e.g. …/postgres"; exit 1; }
psql "$VERIFY_DB_URL" -XAq -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\""
cleanup() { [ "${KEEP:-}" = 1 ] && { echo "Kept database $db"; return; }; psql "$VERIFY_DB_URL" -XAq -c "DROP DATABASE IF EXISTS \"$db\"" || true; }
trap cleanup EXIT

echo "Restoring into an isolated database ($db, PostgreSQL $server_major)…"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$target" "$dump"

work=$(mktemp -d)
psql "$target" -XAt -F' ' -v ON_ERROR_STOP=1 -c "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = '$SCHEMA' and table_type = 'BASE TABLE'" | sort > "$work/counts"
psql "$target" -XAt -v ON_ERROR_STOP=1 -c "
  select 'table ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = '$SCHEMA' and c.relkind = 'r'
  union all select 'index ' || indexname from pg_indexes where schemaname = '$SCHEMA'
  union all select 'fk ' || conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = '$SCHEMA' and c.contype = 'f'" | sort > "$work/schema"
invalid=$(psql "$target" -XAtc "select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = '$SCHEMA' and c.contype = 'f' and not c.convalidated")

ok=1
if ! diff -u "$dump.counts" "$work/counts" > "$work/counts.diff"; then ok=0; echo "Row counts differ from the live database at backup time:"; cat "$work/counts.diff"; fi
if ! diff -u "$dump.schema" "$work/schema" > "$work/schema.diff"; then ok=0; echo "Tables, indexes or foreign keys differ from the live database at backup time:"; cat "$work/schema.diff"; fi
[ "$invalid" = 0 ] || { ok=0; echo "$invalid foreign keys are not valid in the restored database"; }
tables=$(grep -c '^table ' "$work/schema" || true); indexes=$(grep -c '^index ' "$work/schema" || true); fks=$(grep -c '^fk ' "$work/schema" || true)
rows=$(awk '{ s += $2 } END { print s + 0 }' "$work/counts")
rm -rf "$work"
if [ "$ok" = 1 ]; then
  echo "OK: restored into an isolated PostgreSQL $server_major database: $tables tables, $rows rows, $indexes indexes, $fks foreign keys (all valid), the same as the live database at backup time."
else
  echo "FAILED: don't rely on this backup; make a new one."
  exit 2
fi
