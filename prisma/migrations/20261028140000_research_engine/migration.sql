-- Research engine: source provenance on evidence; investigation runs, hypotheses and the evidence graph.
-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "fullText" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passage" TEXT,
ADD COLUMN     "publisher" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sellerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "stopReason" TEXT,
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "trace" JSONB NOT NULL DEFAULT '[]',
    "completeness" JSONB,
    "validation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "researchRunId" TEXT,
    "text" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'inconclusive',
    "status" TEXT NOT NULL DEFAULT 'open',
    "useCase" TEXT,
    "assumptions" TEXT[],
    "supportIds" TEXT[],
    "counterIds" TEXT[],
    "alternatives" TEXT[],
    "rationale" TEXT,
    "validatorNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "fromRef" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "toRef" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceIds" TEXT[],
    "isHypothesis" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ResearchRun_accountId_createdAt_idx" ON "ResearchRun"("accountId", "createdAt");
-- CreateIndex
CREATE INDEX "Hypothesis_accountId_status_idx" ON "Hypothesis"("accountId", "status");
-- CreateIndex
CREATE INDEX "EvidenceLink_accountId_idx" ON "EvidenceLink"("accountId");
-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
