-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "fitReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tierLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useCase" TEXT;
