-- After the migration: owners backfilled, names unique per client, nothing lost; old code still works.
DO $$
DECLARE
  got text;
BEGIN
  FOR got IN
    SELECT format('%s=%s (want %s)', id, coalesce("sellerId", 'null'), want) FROM (
      SELECT c.id, c."sellerId", w.want FROM "Campaign" c JOIN (VALUES ('camp_m', 'manch'), ('camp_b', 'beta'), ('camp_shared', 'null'), ('camp_unused', 'null')) w(id, want) ON w.id = c.id
      UNION ALL SELECT s.id, s."sellerId", w.want FROM "SenderProfile" s JOIN (VALUES ('snd_m', 'manch'), ('snd_b', 'beta'), ('snd_shared', 'null'), ('snd_unused', 'null')) w(id, want) ON w.id = s.id
      UNION ALL SELECT v.id, v."sellerId", w.want FROM "WebVisit" v JOIN (VALUES ('v_matched', 'beta'), ('v_apollo1', 'null'), ('v_apollo2', 'null'), ('v_script', 'null')) w(id, want) ON w.id = v.id
    ) x WHERE coalesce("sellerId", 'null') <> want
  LOOP
    RAISE EXCEPTION 'wrong owner after backfill: %', got;
  END LOOP;
  IF (SELECT count(*) FROM "Campaign") <> 4 OR (SELECT count(*) FROM "SenderProfile") <> 4 OR (SELECT count(*) FROM "WebVisit") <> 4
     OR (SELECT count(*) FROM "Journey") <> 3 OR (SELECT count(*) FROM "ImportBatch") <> 1 OR (SELECT count(*) FROM "Account") <> 2 THEN
    RAISE EXCEPTION 'rows were lost or added by the migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname IN ('Campaign_name_key', 'SenderProfile_name_key')) THEN RAISE EXCEPTION 'global name indexes still there'; END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE indexname IN ('Campaign_sellerId_name_key', 'SenderProfile_sellerId_name_key', 'Campaign_sellerId_idx', 'SenderProfile_sellerId_idx', 'WebVisit_sellerId_occurredAt_idx')) <> 5 THEN
    RAISE EXCEPTION 'per-client indexes missing';
  END IF;
  -- The same name in two clients is allowed; twice in one client is not.
  BEGIN
    INSERT INTO "Campaign" (id, "sellerId", name) VALUES ('t1', 'manch', 'Per-client name'), ('t2', 'beta', 'Per-client name');
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'the same name in two clients was refused';
  END;
  BEGIN
    INSERT INTO "Campaign" (id, "sellerId", name) VALUES ('t3', 'manch', 'Per-client name');
    RAISE EXCEPTION 'the same name twice in one client was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- The code before this migration creates campaigns without an owner, and reads them by name: still works.
  INSERT INTO "Campaign" (id, name) VALUES ('t4', 'Made by the previous code');
  IF (SELECT id FROM "Campaign" WHERE name = 'Made by the previous code' LIMIT 1) <> 't4' THEN RAISE EXCEPTION 'lookup by name failed'; END IF;
  DELETE FROM "Campaign" WHERE id IN ('t1', 't2', 't4');
END $$;
