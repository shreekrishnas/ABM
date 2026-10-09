-- CreateTable
CREATE TABLE "MarketEvent" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "industry" TEXT,
    "bucket" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectSuggestion" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "bucket" TEXT NOT NULL,
    "country" TEXT,
    "employees" INTEGER,
    "score" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "whyNow" TEXT NOT NULL,
    "families" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "reason" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketEvent_sellerId_bucket_publishedAt_idx" ON "MarketEvent"("sellerId", "bucket", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketEvent_sellerId_sourceUrl_nameKey_key" ON "MarketEvent"("sellerId", "sourceUrl", "nameKey");

-- CreateIndex
CREATE INDEX "ProspectSuggestion_sellerId_status_score_idx" ON "ProspectSuggestion"("sellerId", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectSuggestion_sellerId_nameKey_key" ON "ProspectSuggestion"("sellerId", "nameKey");
