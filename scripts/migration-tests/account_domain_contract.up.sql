DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Account_domain_key') THEN RAISE EXCEPTION 'global website index still there'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Account_sellerId_domain_key') THEN RAISE EXCEPTION 'per-client website index missing'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'sellerId' AND table_name IN ('Account', 'ImportBatch') AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'default client still set';
  END IF;
  IF (SELECT count(*) FROM "Account") <> 4 OR (SELECT count(*) FROM "ImportBatch") <> 1 THEN RAISE EXCEPTION 'rows lost or added'; END IF;
  -- Two clients may now hold the same company; one client still can't hold it twice.
  BEGIN
    INSERT INTO "Account" (id, "sellerId", name, domain, "updatedAt") VALUES ('t1', 'beta', 'Acme (Beta)', 'acme.example', now());
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'the same website in two clients was refused';
  END;
  BEGIN
    INSERT INTO "Account" (id, "sellerId", name, domain, "updatedAt") VALUES ('t2', 'beta', 'Acme again', 'acme.example', now());
    RAISE EXCEPTION 'the same website twice in one client was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Without a client named, nothing is assumed any more.
  BEGIN
    INSERT INTO "Account" (id, name, "updatedAt") VALUES ('t3', 'No client', now());
    RAISE EXCEPTION 'a company without a client was accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  DELETE FROM "Account" WHERE id = 't1';
END $$;
