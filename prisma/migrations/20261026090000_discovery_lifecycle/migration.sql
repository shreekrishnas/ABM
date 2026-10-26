-- AI prospect discovery: decision date, revision counter, resurfacing.
ALTER TABLE "ProspectSuggestion" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "ProspectSuggestion" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProspectSuggestion" ADD COLUMN "resurfacedAt" TIMESTAMP(3);
