-- CreateEnum
CREATE TYPE "JourneyStage" AS ENUM ('not_contacted', 'connection_sent', 'connection_accepted', 'follow_up_sent', 'replied_neutral', 'details_requested', 'details_shared', 'interested', 'nurture', 'referred', 'not_interested', 'disqualified', 'call_scheduled', 'demo_scheduled', 'opportunity', 'closed_won', 'closed_lost');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "city" TEXT,
ADD COLUMN     "companyNotes" TEXT,
ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "nameKey" TEXT;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "mapping" JSONB,
ADD COLUMN     "senderId" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SenderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "stage" "JourneyStage" NOT NULL DEFAULT 'not_contacted',
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastEngagementAt" TIMESTAMP(3),
    "lastEngagement" TEXT,
    "stageReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStage" "JourneyStage",
    "toStage" "JourneyStage",
    "detail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_name_key" ON "Campaign"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SenderProfile_name_key" ON "SenderProfile"("name");

-- CreateIndex
CREATE INDEX "Journey_campaignId_senderId_idx" ON "Journey"("campaignId", "senderId");

-- CreateIndex
CREATE INDEX "Journey_stage_idx" ON "Journey"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "Journey_contactId_campaignId_senderId_key" ON "Journey"("contactId", "campaignId", "senderId");

-- CreateIndex
CREATE INDEX "JourneyEvent_journeyId_occurredAt_idx" ON "JourneyEvent"("journeyId", "occurredAt");

-- CreateIndex
CREATE INDEX "Account_linkedinUrl_idx" ON "Account"("linkedinUrl");

-- CreateIndex
CREATE INDEX "Account_nameKey_idx" ON "Account"("nameKey");

-- CreateIndex
CREATE INDEX "Contact_linkedinUrl_idx" ON "Contact"("linkedinUrl");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "SenderProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "SenderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
