-- Background jobs: long tasks started from a button run on their own, so the app stays usable.
CREATE TABLE IF NOT EXISTS "BackgroundJob" (
  "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "sellerId" TEXT NOT NULL, "accountId" TEXT, "label" TEXT NOT NULL,
  "params" JSONB, "status" TEXT NOT NULL DEFAULT 'queued', "message" TEXT, "href" TEXT, "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BackgroundJob_createdBy_createdAt_idx" ON "BackgroundJob"("createdBy", "createdAt");
CREATE INDEX IF NOT EXISTS "BackgroundJob_status_idx" ON "BackgroundJob"("status");
CREATE INDEX IF NOT EXISTS "BackgroundJob_kind_sellerId_status_idx" ON "BackgroundJob"("kind", "sellerId", "status");
