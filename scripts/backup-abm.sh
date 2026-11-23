#!/usr/bin/env bash
# Backup of the app's data (database schema "abm") from production, checked against the live database:
# the backup must hold every table with the same number of rows. Read-only: it never writes to the
# database. Run it on your own computer. Needs the PostgreSQL client tools (pg_dump, pg_restore, psql)
# at the server's major version or newer (production runs Postgres 17).
#
#   export ABM_DB_URL='postgresql://postgres.<project-ref>@aws-<n>-ap-south-1.pooler.supabase.com:5432/postgres'
#   scripts/backup-abm.sh          # asks for the database password; it is never shown or written anywhere
#
# Use the Session pooler connection string (Supabase → Connect → Session pooler, port 5432) WITHOUT the
# password part. The transaction pooler (port 6543) can't run pg_dump. Writes backups/abm-<UTC time>.dump
# plus .counts (rows per table in the file), .live (rows per table in the database), .schema (the live
# database's tables, indexes and foreign keys, for scripts/verify-backup.sh) and .sha256. Never commit or
# share the connection string, the password or the backup files; keep a copy off this computer.
set -euo pipefail
: "${ABM_DB_URL:?Set ABM_DB_URL to the Session pooler connection string, without the password}"
SCHEMA="${ABM_SCHEMA:-abm}"
OUT_DIR="${ABM_BACKUP_DIR:-backups}"
case "$ABM_DB_URL" in *:6543/*) echo "That is the transaction pooler (port 6543). Use the Session pooler (port 5432)."; exit 1 ;; esac
for t in pg_dump pg_restore psql; do
  command -v "$t" >/dev/null || { echo "$t not found: install the PostgreSQL client tools (17 or newer)."; exit 1; }
done
# The password goes through the environment of this script only: never on a command line (other users of
# the computer can see those), in the shell history, or in any file or log.
if [ -z "${PGPASSWORD:-}" ] && ! printf '%s' "$ABM_DB_URL" | grep -qE '^[a-z]+://[^/@:]+:[^/@]+@'; then
  read -rsp "Database password (not shown): " PGPASSWORD
  echo
  export PGPASSWORD
fi
export PGSSLMODE="${PGSSLMODE:-require}" PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"
server=$(psql "$ABM_DB_URL" -XAtc "show server_version_num")
server_major=$((server / 10000))
client_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
if [ "$client_major" -lt "$server_major" ]; then
  echo "pg_dump $client_major is older than the database (Postgres $server_major): install the $server_major client tools."
  exit 1
fi
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$OUT_DIR/$SCHEMA-$stamp.dump"

echo "Backing up schema \"$SCHEMA\" (Postgres $server_major, pg_dump $client_major)…"
pg_dump "$ABM_DB_URL" --schema="$SCHEMA" --format=custom --no-password --file="$file"

# Rows per table in the live database, right after the backup (read-only).
psql "$ABM_DB_URL" -XAt -F' ' -v ON_ERROR_STOP=1 -c "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = '$SCHEMA' and table_type = 'BASE TABLE'" | sort > "$file.live"

# The live database's tables, indexes and foreign keys (read-only), to check a restore against.
psql "$ABM_DB_URL" -XAt -v ON_ERROR_STOP=1 -c "
  select 'table ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = '$SCHEMA' and c.relkind = 'r'
  union all select 'index ' || indexname from pg_indexes where schemaname = '$SCHEMA'
  union all select 'fk ' || conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = '$SCHEMA' and c.contype = 'f'" | sort > "$file.schema"

# Rows per table inside the backup file (no database needed).
pg_restore --data-only --file=- "$file" | awk -v s="$SCHEMA" '
  /^COPY / { t = $2; sub("^" s "\\.", "", t); gsub(/"/, "", t); n = 0; inside = 1; next }
  inside && $0 == "\\." { print t, n; inside = 0; next }
  inside { n++ }' | sort > "$file.counts"

if command -v sha256sum >/dev/null; then sha256sum "$file" > "$file.sha256"; else shasum -a 256 "$file" > "$file.sha256"; fi

tables=$(wc -l < "$file.counts" | tr -d ' ')
rows=$(awk '{ s += $2 } END { print s + 0 }' "$file.counts")
if diff -u "$file.live" "$file.counts" > "$file.diff"; then
  rm -f "$file.diff"
  echo "OK: $file holds $tables tables and $rows rows, the same as the live database."
  echo "Next: scripts/verify-backup.sh $file (restores it into an isolated PostgreSQL database and checks it)."
else
  echo "CHECK: the backup and the live database differ (a table missing, or rows written during the backup):"
  cat "$file.diff"
  echo "Run the script again; if the difference repeats, don't rely on this backup."
  exit 2
fi
