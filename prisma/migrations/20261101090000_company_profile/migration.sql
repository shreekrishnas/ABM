-- CreateEnum
CREATE TYPE "StakeholderType" AS ENUM ('executive', 'board_member', 'independent_director', 'adviser', 'investor');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "addedBy" TEXT,
ADD COLUMN     "addedVia" TEXT,
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "businessModel" TEXT,
ADD COLUMN     "financialHealth" TEXT,
ADD COLUMN     "financialNote" TEXT,
ADD COLUMN     "originDetail" TEXT,
ADD COLUMN     "profileUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "discoveredBy" TEXT,
ADD COLUMN     "influenceReason" TEXT,
ADD COLUMN     "stakeholderType" "StakeholderType" NOT NULL DEFAULT 'executive';

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "createdBy" TEXT;

-- AlterTable
ALTER TABLE "ProspectSuggestion" ADD COLUMN     "requestedBy" TEXT;

-- CreateTable
CREATE TABLE "CompanyFinancial" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "revenue" DOUBLE PRECISION,
    "netProfit" DOUBLE PRECISION,
    "ebitda" DOUBLE PRECISION,
    "totalAssets" DOUBLE PRECISION,
    "totalDebt" DOUBLE PRECISION,
    "revenueUsd" DOUBLE PRECISION,
    "netProfitUsd" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "provider" TEXT,
    "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publisher" TEXT,
    "status" "FieldStatus" NOT NULL DEFAULT 'probable',
    "reports" INTEGER NOT NULL DEFAULT 1,
    "addedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyFinancial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingRound" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "amountUsd" DOUBLE PRECISION,
    "announcedAt" TIMESTAMP(3),
    "investors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leadInvestors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "FieldStatus" NOT NULL DEFAULT 'probable',
    "reports" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechUse" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "category" TEXT NOT NULL,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detail" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySearch" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "queries" JSONB,
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverySearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyFinancial_accountId_idx" ON "CompanyFinancial"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyFinancial_accountId_fiscalYear_source_key" ON "CompanyFinancial"("accountId", "fiscalYear", "source");

-- CreateIndex
CREATE INDEX "FundingRound_accountId_idx" ON "FundingRound"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRound_accountId_stage_announcedAt_key" ON "FundingRound"("accountId", "stage", "announcedAt");

-- CreateIndex
CREATE INDEX "TechUse_accountId_category_idx" ON "TechUse"("accountId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "TechUse_accountId_name_key" ON "TechUse"("accountId", "name");

-- CreateIndex
CREATE INDEX "DiscoverySearch_sellerId_createdAt_idx" ON "DiscoverySearch"("sellerId", "createdAt");

-- AddForeignKey
ALTER TABLE "CompanyFinancial" ADD CONSTRAINT "CompanyFinancial_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingRound" ADD CONSTRAINT "FundingRound_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechUse" ADD CONSTRAINT "TechUse_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

