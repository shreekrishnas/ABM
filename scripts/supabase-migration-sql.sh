#!/usr/bin/env bash
# Prints the SQL that applies (or rolls back) one Prisma migration on production the way production's
# migrations are applied: through Supabase (apply_migration, or the SQL editor), in the app's schema
# "abm", and recorded in Prisma's migration history so a later `prisma migrate deploy` never applies it
# twice. It only prints; it never connects to a database.
#
#   scripts/supabase-migration-sql.sh 20261123100000_client_ownership             # apply
#   scripts/supabase-migration-sql.sh 20261123100000_client_ownership --rollback  # roll back
#
# Never run `prisma migrate deploy` against production: its history (_prisma_migrations) lacks
# migrations that were applied through Supabase, so it would try to apply them again.
set -euo pipefail
name="${1:?migration folder name, e.g. 20261123100000_client_ownership}"
migration="prisma/migrations/$name/migration.sql"
rollback="prisma/rollbacks/$name.sql"
[ -f "$migration" ] || { echo "No such migration: $migration" >&2; exit 1; }
echo "SET search_path TO abm;"
echo "SET lock_timeout = '5s';"
if [ "${2:-}" = "--rollback" ]; then
  [ -f "$rollback" ] || { echo "No rollback script: $rollback" >&2; exit 1; }
  cat "$rollback" # it removes its own _prisma_migrations row
else
  cat "$migration"
  cat <<SQL
INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'manual', '$name', now(), now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '$name');
SQL
fi
