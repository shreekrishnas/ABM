-- Production only (Supabase): tables created through the admin connection must be readable by
-- the app's role. Grant on everything, and by default on anything created later.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'abm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA ' || current_schema() || ' TO abm_app';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ' || current_schema() || ' TO abm_app';
  END IF;
END $$;
