-- AlterTable
ALTER TABLE "ProspectSuggestion" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'market',
ADD COLUMN     "seed" TEXT;
