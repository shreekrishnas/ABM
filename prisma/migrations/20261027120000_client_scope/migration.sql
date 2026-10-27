-- Client separation: an import belongs to the client it was made for.
ALTER TABLE "ImportBatch" ADD COLUMN "sellerId" TEXT NOT NULL DEFAULT 'manch';
CREATE INDEX "ImportBatch_sellerId_idx" ON "ImportBatch"("sellerId");
