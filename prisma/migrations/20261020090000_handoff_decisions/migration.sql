-- Lookalike seed profile (for "why similar") and hand-off decisions (accept / send back with a reason).
ALTER TABLE "ProspectSuggestion" ADD COLUMN "seedProfile" JSONB;
ALTER TABLE "Handoff" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "Handoff" ADD COLUMN "decisionReason" TEXT;
ALTER TABLE "Handoff" ADD COLUMN "decidedBy" TEXT;
ALTER TABLE "Handoff" ADD COLUMN "decidedAt" TIMESTAMP(3);
UPDATE "Handoff" SET "status" = 'accepted' WHERE "acknowledgedAt" IS NOT NULL;
