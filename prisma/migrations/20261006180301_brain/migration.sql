-- AlterEnum
ALTER TYPE "LedgerKind" ADD VALUE 'search';

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "claimCheck" JSONB,
ADD COLUMN     "painPoint" TEXT,
ADD COLUMN     "useCase" TEXT;

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "engine" TEXT,
ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ResearchPlan" ADD COLUMN     "hypotheses" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "planner" TEXT;

-- CreateTable
CREATE TABLE "ResearchQuery" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "pass" TEXT NOT NULL,
    "purpose" TEXT,
    "results" INTEGER NOT NULL DEFAULT 0,
    "kept" INTEGER NOT NULL DEFAULT 0,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "pages" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBrief" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "brief" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainInsight" (
    "id" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchQuery_accountId_key_queryHash_idx" ON "ResearchQuery"("accountId", "key", "queryHash");

-- CreateIndex
CREATE INDEX "ResearchQuery_engine_key_idx" ON "ResearchQuery"("engine", "key");

-- CreateIndex
CREATE INDEX "ResearchQuery_createdAt_idx" ON "ResearchQuery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBrief_accountId_version_key" ON "AccountBrief"("accountId", "version");

-- AddForeignKey
ALTER TABLE "ResearchQuery" ADD CONSTRAINT "ResearchQuery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBrief" ADD CONSTRAINT "AccountBrief_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
