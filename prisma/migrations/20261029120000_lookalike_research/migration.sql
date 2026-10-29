-- Lookalikes: AI investigation results on each suggestion, and who decided.
ALTER TABLE "ProspectSuggestion"
  ADD COLUMN "fitScore" INTEGER,
  ADD COLUMN "readiness" TEXT,
  ADD COLUMN "readinessScore" INTEGER,
  ADD COLUMN "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "evidence" JSONB,
  ADD COLUMN "research" JSONB,
  ADD COLUMN "researchStatus" TEXT,
  ADD COLUMN "researchNote" TEXT,
  ADD COLUMN "researchedAt" TIMESTAMP(3),
  ADD COLUMN "decidedBy" TEXT;
CREATE INDEX "ProspectSuggestion_sellerId_researchStatus_idx" ON "ProspectSuggestion"("sellerId", "researchStatus");
