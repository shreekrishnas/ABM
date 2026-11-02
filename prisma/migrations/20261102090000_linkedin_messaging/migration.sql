-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "summary" JSONB,
ADD COLUMN     "summaryEditedBy" TEXT,
ADD COLUMN     "upToDateAt" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "LinkedInMessage" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentText" TEXT,
    "why" TEXT,
    "angle" TEXT,
    "factIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checks" JSONB,
    "analysis" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "sentBy" TEXT,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LinkedInMessage_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "LinkedInMessage_journeyId_createdAt_idx" ON "LinkedInMessage"("journeyId", "createdAt");
-- CreateIndex
CREATE INDEX "LinkedInMessage_contactId_idx" ON "LinkedInMessage"("contactId");
-- AddForeignKey
ALTER TABLE "LinkedInMessage" ADD CONSTRAINT "LinkedInMessage_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
