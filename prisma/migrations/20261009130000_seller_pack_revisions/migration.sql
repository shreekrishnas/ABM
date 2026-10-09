-- CreateTable
CREATE TABLE "SellerPackRevision" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "pack" JSONB,
    "version" TEXT NOT NULL,
    "changed" TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerPackRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerPackRevision_sellerId_createdAt_idx" ON "SellerPackRevision"("sellerId", "createdAt");
