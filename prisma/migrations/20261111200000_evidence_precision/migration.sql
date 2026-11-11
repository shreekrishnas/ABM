-- Research precision: event date, page date, undated flag, canonical URL, confidence per fact.
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "eventDate" TIMESTAMP(3);
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "pageDate" TIMESTAMP(3);
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "undated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "confidence" INTEGER;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "checkedBy" TEXT;
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "checkedAt" TIMESTAMP(3);
