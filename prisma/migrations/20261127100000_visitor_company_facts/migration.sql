-- Company facts from Apollo's website-visitor pull (employees, annual revenue, industry), per client and company.
-- Additive only: a new table, nothing existing changes. Rollback: DROP TABLE "VisitorCompanyFacts".
CREATE TABLE "VisitorCompanyFacts" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "domain" TEXT,
    "employees" INTEGER,
    "revenueUsd" DOUBLE PRECISION,
    "industry" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VisitorCompanyFacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitorCompanyFacts_sellerId_companyKey_key" ON "VisitorCompanyFacts"("sellerId", "companyKey");
