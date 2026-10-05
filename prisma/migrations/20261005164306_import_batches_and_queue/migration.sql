-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "lastImportBatchId" TEXT,
ADD COLUMN     "queuedFromStage" INTEGER;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "ignoredColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "processed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stats" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'done',
ADD COLUMN     "toProcess" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Account_pipelineStatus_idx" ON "Account"("pipelineStatus");
