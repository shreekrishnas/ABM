// What each review item is, in plain words (shared by Approvals, Overview and Today).
import type { ReviewType } from "@prisma/client";

export const REVIEW_TYPE_LABEL: Partial<Record<ReviewType, string>> = {
  draft_approval: "Email to approve",
  identity_conflict: "Is this the right person?",
  contradiction: "Sources disagree",
  guardrail_failed: "Email held by checks",
  budget_exceeded: "Research budget reached",
  no_usable_person: "Nobody to contact yet",
  lawful_basis_missing: "Missing legal basis",
  briefing_blocked: "Hand-off brief blocked",
  needs_human_reply: "Unclear reply",
  bounce_breaker: "Too many bounces — sending paused",
  other: "Suggestion or other",
};
