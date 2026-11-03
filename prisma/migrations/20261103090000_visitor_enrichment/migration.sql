-- CreateTable
CREATE TABLE "VisitorEnrichment" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "domain" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "rows" JSONB NOT NULL DEFAULT '[]',
    "enrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrichedBy" TEXT,
    "importedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "importedBy" TEXT,

    CONSTRAINT "VisitorEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitorEnrichment_sellerId_companyKey_key" ON "VisitorEnrichment"("sellerId", "companyKey");
