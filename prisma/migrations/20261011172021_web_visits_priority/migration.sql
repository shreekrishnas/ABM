-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "priorityParts" JSONB,
ADD COLUMN     "priorityScore" INTEGER;

-- CreateTable
CREATE TABLE "WebVisit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "visitorId" TEXT,
    "companyName" TEXT,
    "companyDomain" TEXT,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT,
    "topic" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "referrer" TEXT,
    "durationSec" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebVisit_accountId_occurredAt_idx" ON "WebVisit"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "WebVisit_contactId_occurredAt_idx" ON "WebVisit"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "WebVisit_visitorId_idx" ON "WebVisit"("visitorId");

-- CreateIndex
CREATE INDEX "WebVisit_companyDomain_idx" ON "WebVisit"("companyDomain");
