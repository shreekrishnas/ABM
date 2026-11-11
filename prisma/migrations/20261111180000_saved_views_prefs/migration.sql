-- AlterTable
ALTER TABLE "User" ADD COLUMN "prefs" JSONB;

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SavedView_page_ownerEmail_idx" ON "SavedView"("page", "ownerEmail");
