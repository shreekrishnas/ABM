-- Phase 1: evidence freshness gate and automatic retry of temporary failures.
ALTER TYPE "DraftStatus" ADD VALUE IF NOT EXISTS 'needs_refresh';
ALTER TYPE "ReviewType" ADD VALUE IF NOT EXISTS 'draft_refresh';
ALTER TYPE "ReviewType" ADD VALUE IF NOT EXISTS 'retry_exhausted';
ALTER TABLE "Draft" ADD COLUMN "replacesId" TEXT;
ALTER TABLE "Account" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "lastError" TEXT;
