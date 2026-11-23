-- Rollback of migration 20261123110000_account_domain_contract. Run in the app's schema (production:
-- SET search_path TO abm;). Restores the global unique website index and the old defaults. Refuses if
-- two clients now hold the same website (the global index can't be rebuilt then).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Account" WHERE "domain" IS NOT NULL GROUP BY "domain" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Two clients now hold the same company website: the global unique index cannot be restored';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Account_domain_key" ON "Account"("domain");
ALTER TABLE "Account" ALTER COLUMN "sellerId" SET DEFAULT 'manch';
ALTER TABLE "ImportBatch" ALTER COLUMN "sellerId" SET DEFAULT 'manch';
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123110000_account_domain_contract';
  END IF;
END $$;
