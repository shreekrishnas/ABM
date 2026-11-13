-- Put back the two indexes removed in db_health (nothing is removed from the database without asking).
CREATE INDEX IF NOT EXISTS "BrainSignal_type_createdAt_idx" ON "BrainSignal"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "Decision_module_createdAt_idx" ON "Decision"("module", "createdAt");
