-- AlterTable
ALTER TABLE "ErrorLog" ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RunLog" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "note" TEXT,
    CONSTRAINT "RunLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RunLog_finishedAt_idx" ON "RunLog"("finishedAt");
