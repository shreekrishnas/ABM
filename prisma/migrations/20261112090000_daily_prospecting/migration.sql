-- Daily "Recommended today": careers feeds, daily lists, snooze and reject reason on suggestions.
ALTER TABLE "ProspectSuggestion" ADD COLUMN IF NOT EXISTS "snoozedUntil" TIMESTAMP(3);
ALTER TABLE "ProspectSuggestion" ADD COLUMN IF NOT EXISTS "rejectReasonKey" TEXT;
CREATE TABLE IF NOT EXISTS "CareersFeed" (
  "id" TEXT NOT NULL, "sellerId" TEXT NOT NULL, "accountId" TEXT, "suggestionId" TEXT, "domain" TEXT NOT NULL,
  "ats" TEXT, "slug" TEXT, "status" TEXT NOT NULL, "note" TEXT,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastJobs" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareersFeed_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CareersFeed_sellerId_domain_key" ON "CareersFeed"("sellerId", "domain");
CREATE INDEX IF NOT EXISTS "CareersFeed_sellerId_lastCheckedAt_idx" ON "CareersFeed"("sellerId", "lastCheckedAt");
CREATE TABLE IF NOT EXISTS "DailyRecommendation" (
  "id" TEXT NOT NULL, "sellerId" TEXT NOT NULL, "date" TEXT NOT NULL, "items" JSONB NOT NULL, "summary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyRecommendation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DailyRecommendation_sellerId_date_key" ON "DailyRecommendation"("sellerId", "date");
