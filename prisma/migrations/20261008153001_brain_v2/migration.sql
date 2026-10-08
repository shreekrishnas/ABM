-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "sellerId" TEXT NOT NULL DEFAULT 'manch';

-- AlterTable
ALTER TABLE "AccountBrief" ADD COLUMN     "sellerId" TEXT,
ADD COLUMN     "sellerPackVersion" TEXT;

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "critique" JSONB,
ADD COLUMN     "rewrites" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sellerId" TEXT,
ADD COLUMN     "sellerPackVersion" TEXT;

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "quote" TEXT,
ADD COLUMN     "sellerId" TEXT,
ADD COLUMN     "sellerPackVersion" TEXT;

-- CreateTable
CREATE TABLE "BrainSignal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "accountId" TEXT,
    "sellerId" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "draftId" TEXT,
    "module" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "caseFor" TEXT NOT NULL,
    "caseAgainst" TEXT NOT NULL,
    "evidenceFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceAgainst" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "autonomy" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "tentative" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrainSignal_accountId_createdAt_idx" ON "BrainSignal"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "BrainSignal_runId_idx" ON "BrainSignal"("runId");

-- CreateIndex
CREATE INDEX "BrainSignal_type_createdAt_idx" ON "BrainSignal"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_accountId_createdAt_idx" ON "Decision"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_module_createdAt_idx" ON "Decision"("module", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_status_createdAt_idx" ON "Proposal"("status", "createdAt");
