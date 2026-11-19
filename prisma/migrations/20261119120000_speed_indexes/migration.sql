-- Additive only: indexes for the filters the dashboard and lists use most.
CREATE INDEX IF NOT EXISTS "ReviewItem_status_createdAt_idx" ON "ReviewItem"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "JourneyEvent_journeyId_type_idx" ON "JourneyEvent"("journeyId", "type");
CREATE INDEX IF NOT EXISTS "Account_createdAt_idx" ON "Account"("createdAt");
