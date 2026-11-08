-- AlterTable
ALTER TABLE "UserClient" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'manager';
ALTER TABLE "User" ADD COLUMN "lastSignInAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SignInEvent" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignInEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SignInEvent_email_createdAt_idx" ON "SignInEvent"("email", "createdAt");
CREATE INDEX "SignInEvent_createdAt_idx" ON "SignInEvent"("createdAt");
