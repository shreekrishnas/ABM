-- Spending records can belong to an account as a whole (lookalike research), not only a company.
ALTER TABLE "LedgerEntry" ALTER COLUMN "accountId" DROP NOT NULL;
ALTER TABLE "LedgerEntry" ADD COLUMN "sellerId" TEXT;
UPDATE "LedgerEntry" l SET "sellerId" = a."sellerId" FROM "Account" a WHERE a.id = l."accountId" AND l."sellerId" IS NULL;
CREATE INDEX "LedgerEntry_sellerId_createdAt_idx" ON "LedgerEntry"("sellerId", "createdAt");

-- Monthly spending cap per client account.
ALTER TABLE "Client" ADD COLUMN "monthlyBudgetUsd" INTEGER;

-- Server errors kept beyond the host's log retention.
CREATE TABLE "ErrorLog" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "detail" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ErrorLog_fingerprint_key" ON "ErrorLog"("fingerprint");
CREATE INDEX "ErrorLog_lastSeen_idx" ON "ErrorLog"("lastSeen");

-- Request counters for rate limits.
CREATE TABLE "RateLimit" (
  "key" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- Cached web searches (48 hours).
CREATE TABLE "SearchCache" (
  "key" TEXT NOT NULL,
  "pages" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "SearchCache_createdAt_idx" ON "SearchCache"("createdAt");

-- Faster signal feeds and audit filters.
CREATE INDEX "Signal_occurredAt_idx" ON "Signal"("occurredAt");
CREATE INDEX "AuditEntry_actorEmail_idx" ON "AuditEntry"("actorEmail");
CREATE INDEX "AuditEntry_action_idx" ON "AuditEntry"("action");
