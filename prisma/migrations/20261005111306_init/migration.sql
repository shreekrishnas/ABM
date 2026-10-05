-- CreateEnum
CREATE TYPE "FieldStatus" AS ENUM ('verified', 'probable', 'conflicting', 'stale', 'invalid', 'unknown');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('prospect', 'customer', 'competitor', 'partner');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('T1', 'T2', 'T3');

-- CreateEnum
CREATE TYPE "BuyingStage" AS ENUM ('UNAWARE', 'AWARE', 'ENGAGED', 'MQA', 'OPPORTUNITY', 'CUSTOMER', 'WATCH', 'DISQUALIFIED', 'RECYCLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "BuyingRole" AS ENUM ('decision_maker', 'champion', 'influencer', 'budget_owner', 'unknown');

-- CreateEnum
CREATE TYPE "ContactState" AS ENUM ('new', 'selected', 'ready', 'in_sequence', 'paused', 'replied', 'handed_off', 'suppressed', 'do_not_contact');

-- CreateEnum
CREATE TYPE "ReadinessOutcome" AS ENUM ('ready', 'targeted_re_research', 'watch', 'human_review', 'disqualified');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'blocked', 'sent');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'delivered', 'bounced', 'duplicate_skipped', 'failed');

-- CreateEnum
CREATE TYPE "ReplyClass" AS ENUM ('positive', 'objection', 'not_now', 'unsubscribe', 'wrong_person', 'out_of_office', 'needs_human');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('email', 'linkedin', 'call', 'task');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('active', 'paused', 'completed', 'stopped');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('email_open', 'email_click', 'email_reply', 'site_visit', 'pricing_visit', 'intent_surge', 'job_change', 'event_attended', 'content_download');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('identity_conflict', 'contradiction', 'draft_approval', 'guardrail_failed', 'budget_exceeded', 'no_usable_person', 'lawful_basis_missing', 'briefing_blocked', 'needs_human_reply', 'bounce_breaker', 'other');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('waiting', 'due', 'processed', 'cancelled');

-- CreateEnum
CREATE TYPE "OppStage" AS ENUM ('discovery', 'qualification', 'proposal', 'negotiation', 'won', 'lost');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "EventOutcome" AS ENUM ('pass', 'block', 'info', 'error');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('llm', 'lookup', 'verification');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'marketer', 'rep', 'reviewer');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'rep',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "employees" INTEGER,
    "country" TEXT,
    "revenueUsd" BIGINT,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationship" "Relationship" NOT NULL DEFAULT 'prospect',
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "tier" "Tier",
    "stage" "BuyingStage" NOT NULL DEFAULT 'UNAWARE',
    "fitScore" INTEGER,
    "dataConfidence" DOUBLE PRECISION,
    "researchPriority" "Priority",
    "intentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoredAt" TIMESTAMP(3),
    "pipelineStage" INTEGER NOT NULL DEFAULT 0,
    "pipelineStatus" TEXT NOT NULL DEFAULT 'idle',
    "followupUsed" BOOLEAN NOT NULL DEFAULT false,
    "reopenUsed" BOOLEAN NOT NULL DEFAULT false,
    "disqualifyReason" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "title" TEXT,
    "titleNormalized" TEXT,
    "function" TEXT,
    "seniority" TEXT,
    "buyingRole" "BuyingRole" NOT NULL DEFAULT 'unknown',
    "identityConfidence" DOUBLE PRECISION,
    "state" "ContactState" NOT NULL DEFAULT 'new',
    "readiness" "ReadinessOutcome",
    "readinessReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lawfulBasis" TEXT,
    "country" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountUsd" INTEGER NOT NULL DEFAULT 0,
    "stage" "OppStage" NOT NULL DEFAULT 'discovery',
    "source" TEXT NOT NULL DEFAULT 'abm',
    "closeDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "factTypesAtClose" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "channel" "Channel" NOT NULL DEFAULT 'task',
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "dueAt" TIMESTAMP(3),
    "accountId" TEXT,
    "contactId" TEXT,
    "assigneeId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldState" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "status" "FieldStatus" NOT NULL DEFAULT 'unknown',
    "source" TEXT,
    "observedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recheckUsed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FieldState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "value" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "isNegative" BOOLEAN NOT NULL DEFAULT false,
    "negativeKind" TEXT,
    "status" "FieldStatus" NOT NULL DEFAULT 'probable',
    "supersededById" TEXT,
    "pass" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwinVersion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwinVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "skipped" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "type" "SignalType" NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "attributed" BOOLEAN NOT NULL DEFAULT false,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "detail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "Tier",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "channel" "Channel" NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
    "nextDueAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL DEFAULT 1,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "angle" TEXT,
    "claims" JSONB NOT NULL,
    "leadEvidenceId" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'pending_review',
    "guardrailAttempts" INTEGER NOT NULL DEFAULT 0,
    "blockReason" TEXT,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "bounceType" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "contactId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "class" "ReplyClass" NOT NULL,
    "route" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "stage" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "outcome" "EventOutcome" NOT NULL,
    "reason" TEXT,
    "data" JSONB,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "type" "ReviewType" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "draftId" TEXT,
    "payload" JSONB,
    "dueAt" TIMESTAMP(3),
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recheckAt" TIMESTAMP(3) NOT NULL,
    "status" "WatchStatus" NOT NULL DEFAULT 'waiting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amountMicros" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ownerId" TEXT,
    "trigger" TEXT NOT NULL,
    "briefing" JSONB NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "alertedAt" TIMESTAMP(3),
    "ackDueAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "dailyCap" INTEGER NOT NULL DEFAULT 40,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "warmedUp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "errors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_domain_key" ON "Account"("domain");

-- CreateIndex
CREATE INDEX "Account_stage_idx" ON "Account"("stage");

-- CreateIndex
CREATE INDEX "Account_tier_idx" ON "Account"("tier");

-- CreateIndex
CREATE INDEX "Account_ownerId_idx" ON "Account"("ownerId");

-- CreateIndex
CREATE INDEX "Account_mergedIntoId_idx" ON "Account"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_state_idx" ON "Contact"("state");

-- CreateIndex
CREATE INDEX "Opportunity_accountId_idx" ON "Opportunity"("accountId");

-- CreateIndex
CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage");

-- CreateIndex
CREATE INDEX "Task_status_dueAt_idx" ON "Task"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_accountId_idx" ON "Task"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldState_accountId_field_key" ON "FieldState"("accountId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "FieldState_contactId_field_key" ON "FieldState"("contactId", "field");

-- CreateIndex
CREATE INDEX "Evidence_accountId_key_idx" ON "Evidence"("accountId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TwinVersion_accountId_version_key" ON "TwinVersion"("accountId", "version");

-- CreateIndex
CREATE INDEX "ResearchPlan_accountId_idx" ON "ResearchPlan"("accountId");

-- CreateIndex
CREATE INDEX "Signal_accountId_occurredAt_idx" ON "Signal"("accountId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_order_key" ON "SequenceStep"("sequenceId", "order");

-- CreateIndex
CREATE INDEX "Enrollment_status_nextDueAt_idx" ON "Enrollment"("status", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_contactId_sequenceId_key" ON "Enrollment"("contactId", "sequenceId");

-- CreateIndex
CREATE INDEX "Draft_status_idx" ON "Draft"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Message_draftId_key" ON "Message"("draftId");

-- CreateIndex
CREATE INDEX "Message_sentAt_idx" ON "Message"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_value_key" ON "Suppression"("value");

-- CreateIndex
CREATE INDEX "PipelineEvent_accountId_createdAt_idx" ON "PipelineEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_stage_outcome_idx" ON "PipelineEvent"("stage", "outcome");

-- CreateIndex
CREATE INDEX "PipelineEvent_runId_idx" ON "PipelineEvent"("runId");

-- CreateIndex
CREATE INDEX "ReviewItem_status_type_idx" ON "ReviewItem"("status", "type");

-- CreateIndex
CREATE INDEX "WatchlistEntry_status_recheckAt_idx" ON "WatchlistEntry"("status", "recheckAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");

-- CreateIndex
CREATE INDEX "Handoff_acknowledgedAt_idx" ON "Handoff"("acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_address_key" ON "Mailbox"("address");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldState" ADD CONSTRAINT "FieldState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldState" ADD CONSTRAINT "FieldState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwinVersion" ADD CONSTRAINT "TwinVersion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlan" ADD CONSTRAINT "ResearchPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineEvent" ADD CONSTRAINT "PipelineEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
