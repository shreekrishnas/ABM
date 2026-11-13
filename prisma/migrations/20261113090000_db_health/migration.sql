-- Database health: indexes for every foreign key and the app's common filters, two unused indexes dropped,
-- and a range check on Evidence.confidence. (Run ANALYZE after applying.)
CREATE INDEX IF NOT EXISTS "Draft_contactId_idx" ON "Draft"("contactId");
CREATE INDEX IF NOT EXISTS "Enrollment_sequenceId_idx" ON "Enrollment"("sequenceId");
CREATE INDEX IF NOT EXISTS "EvidenceLink_hypothesisId_idx" ON "EvidenceLink"("hypothesisId");
CREATE INDEX IF NOT EXISTS "Handoff_accountId_idx" ON "Handoff"("accountId");
CREATE INDEX IF NOT EXISTS "Handoff_ownerId_idx" ON "Handoff"("ownerId");
CREATE INDEX IF NOT EXISTS "Hypothesis_researchRunId_idx" ON "Hypothesis"("researchRunId");
CREATE INDEX IF NOT EXISTS "ImportBatch_campaignId_idx" ON "ImportBatch"("campaignId");
CREATE INDEX IF NOT EXISTS "ImportBatch_senderId_idx" ON "ImportBatch"("senderId");
CREATE INDEX IF NOT EXISTS "Journey_senderId_idx" ON "Journey"("senderId");
CREATE INDEX IF NOT EXISTS "Message_contactId_idx" ON "Message"("contactId");
CREATE INDEX IF NOT EXISTS "Note_accountId_idx" ON "Note"("accountId");
CREATE INDEX IF NOT EXISTS "Note_contactId_idx" ON "Note"("contactId");
CREATE INDEX IF NOT EXISTS "Note_authorId_idx" ON "Note"("authorId");
CREATE INDEX IF NOT EXISTS "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");
CREATE INDEX IF NOT EXISTS "Reply_messageId_idx" ON "Reply"("messageId");
CREATE INDEX IF NOT EXISTS "Reply_contactId_idx" ON "Reply"("contactId");
CREATE INDEX IF NOT EXISTS "ReviewItem_accountId_idx" ON "ReviewItem"("accountId");
CREATE INDEX IF NOT EXISTS "ReviewItem_contactId_idx" ON "ReviewItem"("contactId");
CREATE INDEX IF NOT EXISTS "Signal_contactId_idx" ON "Signal"("contactId");
CREATE INDEX IF NOT EXISTS "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX IF NOT EXISTS "Task_contactId_idx" ON "Task"("contactId");
CREATE INDEX IF NOT EXISTS "UserClient_clientId_idx" ON "UserClient"("clientId");
CREATE INDEX IF NOT EXISTS "WatchlistEntry_accountId_idx" ON "WatchlistEntry"("accountId");
CREATE INDEX IF NOT EXISTS "Account_sellerId_pipelineStatus_idx" ON "Account"("sellerId", "pipelineStatus");
CREATE INDEX IF NOT EXISTS "Account_sellerId_stage_idx" ON "Account"("sellerId", "stage");
CREATE INDEX IF NOT EXISTS "PipelineEvent_step_createdAt_idx" ON "PipelineEvent"("step", "createdAt");
CREATE INDEX IF NOT EXISTS "Evidence_accountId_canonicalUrl_idx" ON "Evidence"("accountId", "canonicalUrl");
CREATE INDEX IF NOT EXISTS "Evidence_accountId_createdAt_idx" ON "Evidence"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "Decision_contactId_createdAt_idx" ON "Decision"("contactId", "createdAt");
CREATE INDEX IF NOT EXISTS "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");
-- (two DROP INDEX lines were here; reverted by 20261113120000_restore_indexes)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Evidence_confidence_range') THEN
    ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100));
  END IF;
END $$;
