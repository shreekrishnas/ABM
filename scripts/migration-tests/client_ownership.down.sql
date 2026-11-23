-- After the rollback: back to the previous shape, every row kept, ready to re-apply.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'sellerId' AND table_name IN ('Campaign', 'SenderProfile', 'WebVisit')) THEN
    RAISE EXCEPTION 'owner columns still there';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE indexname IN ('Campaign_name_key', 'SenderProfile_name_key')) <> 2 THEN RAISE EXCEPTION 'global name indexes not restored'; END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname IN ('Campaign_sellerId_name_key', 'SenderProfile_sellerId_name_key', 'Campaign_sellerId_idx', 'SenderProfile_sellerId_idx', 'WebVisit_sellerId_occurredAt_idx')) THEN
    RAISE EXCEPTION 'per-client indexes still there';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261123100000_client_ownership') THEN RAISE EXCEPTION 'migration still recorded'; END IF;
  IF (SELECT count(*) FROM "Campaign") <> 4 OR (SELECT count(*) FROM "SenderProfile") <> 4 OR (SELECT count(*) FROM "WebVisit") <> 4 OR (SELECT count(*) FROM "Journey") <> 3 THEN
    RAISE EXCEPTION 'rows were lost by the rollback';
  END IF;
END $$;
