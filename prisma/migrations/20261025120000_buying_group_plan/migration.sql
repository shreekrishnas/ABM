-- Phase 2: company contact plan and company-wide outreach pauses.
ALTER TABLE "Contact" ADD COLUMN "planOrder" INTEGER;
ALTER TABLE "Contact" ADD COLUMN "planStartAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "planReason" TEXT;
ALTER TABLE "Account" ADD COLUMN "outreachPausedUntil" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "outreachPauseReason" TEXT;
