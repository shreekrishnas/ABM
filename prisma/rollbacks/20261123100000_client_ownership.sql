-- Rollback of migration 20261123100000_client_ownership (S-4). Run in the app's schema
-- (production: SET search_path TO abm;). Restores global name uniqueness and drops the owner columns.
-- Refuses if two campaigns or two senders now share a name (two clients each made one): the old
-- global unique index can't be rebuilt then, so rename one first. The deployed code must be rolled
-- back first: code that filters by client needs the columns.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Campaign" GROUP BY "name" HAVING COUNT(*) > 1)
     OR EXISTS (SELECT 1 FROM "SenderProfile" GROUP BY "name" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Two campaigns or senders share a name (different clients): rename one before rolling back';
  END IF;
END $$;
DROP INDEX IF EXISTS "WebVisit_sellerId_occurredAt_idx";
DROP INDEX IF EXISTS "SenderProfile_sellerId_idx";
DROP INDEX IF EXISTS "Campaign_sellerId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_name_key" ON "Campaign"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SenderProfile_name_key" ON "SenderProfile"("name");
DROP INDEX IF EXISTS "Campaign_sellerId_name_key";
DROP INDEX IF EXISTS "SenderProfile_sellerId_name_key";
ALTER TABLE "WebVisit" DROP COLUMN IF EXISTS "sellerId";
ALTER TABLE "SenderProfile" DROP COLUMN IF EXISTS "sellerId";
ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "sellerId";
-- Forget the migration so a later `prisma migrate deploy` applies it again.
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123100000_client_ownership';
  END IF;
END $$;
