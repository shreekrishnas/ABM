-- AlterTable
ALTER TABLE "AssistantConversation" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "sellerId" TEXT;
-- AlterTable
ALTER TABLE "AssistantMessage" ADD COLUMN     "actionIds" TEXT[];
-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "conversationId" TEXT,
    "tool" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceIds" TEXT[],
    "input" JSONB NOT NULL,
    "result" JSONB,
    "undo" JSONB,
    "reversible" BOOLEAN NOT NULL DEFAULT false,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "runAt" TIMESTAMP(3),
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "AgentSetting" (
    "sellerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "allowedTools" JSONB NOT NULL DEFAULT '[]',
    "dailyCapUsd" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "quietHours" JSONB,
    "notify" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentSetting_pkey" PRIMARY KEY ("sellerId")
);
-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_idempotencyKey_key" ON "AgentAction"("idempotencyKey");
-- CreateIndex
CREATE INDEX "AgentAction_sellerId_createdAt_idx" ON "AgentAction"("sellerId", "createdAt");
-- CreateIndex
CREATE INDEX "AgentAction_accountId_createdAt_idx" ON "AgentAction"("accountId", "createdAt");
-- CreateIndex
CREATE INDEX "AgentAction_status_runAt_idx" ON "AgentAction"("status", "runAt");
-- CreateIndex
CREATE INDEX "AgentAction_conversationId_idx" ON "AgentAction"("conversationId");
-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_dedupeKey_key" ON "AgentEvent"("dedupeKey");
-- CreateIndex
CREATE INDEX "AgentEvent_sellerId_processedAt_idx" ON "AgentEvent"("sellerId", "processedAt");
