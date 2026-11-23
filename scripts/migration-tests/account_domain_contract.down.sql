DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Account_domain_key') THEN RAISE EXCEPTION 'global website index not restored'; END IF;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Account' AND column_name = 'sellerId') IS NULL THEN RAISE EXCEPTION 'default not restored'; END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261123110000_account_domain_contract') THEN RAISE EXCEPTION 'migration still recorded'; END IF;
  IF (SELECT count(*) FROM "Account") <> 4 OR (SELECT count(*) FROM "ImportBatch") <> 1 THEN RAISE EXCEPTION 'rows lost by the rollback'; END IF;
END $$;
