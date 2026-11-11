-- CreateTable
CREATE TABLE "AssistantSavedQuestion" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantSavedQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssistantSavedQuestion_userEmail_text_key" ON "AssistantSavedQuestion"("userEmail", "text");
CREATE INDEX "AssistantSavedQuestion_userEmail_createdAt_idx" ON "AssistantSavedQuestion"("userEmail", "createdAt");
