// Plain-word labels for every code value people can see. One dictionary, so no screen ever
// shows a raw code like "possible_blocker". Records are complete on purpose: a new value
// fails the type check until it gets a label.
import type { BuyingRole, BuyingStage, ContactState, ReadinessOutcome, ReviewType } from "@prisma/client";

export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
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
  draft_refresh: "Email needs a fresh version",
  retry_exhausted: "Research keeps failing",
  possible_blocker: "Possible blocker",
  other: "Suggestion or other",
};

export const STAGE_LABEL: Record<BuyingStage, string> = {
  UNAWARE: "Not yet aware", AWARE: "Aware", ENGAGED: "Engaged", MQA: "Ready for sales", OPPORTUNITY: "Opportunity",
  CUSTOMER: "Customer", WATCH: "Watching", DISQUALIFIED: "Ruled out", RECYCLED: "Back in research",
};

export const ROLE_LABEL: Record<BuyingRole, string> = {
  decision_maker: "Decision maker", champion: "Champion", influencer: "Influencer", budget_owner: "Budget owner", unknown: "Role unknown",
};

export const READINESS_LABEL: Record<ReadinessOutcome, string> = {
  ready: "Ready", targeted_re_research: "Researching again", watch: "Watching", human_review: "Needs a person", disqualified: "Ruled out",
};

export const CONTACT_STATE_LABEL: Record<ContactState, string> = {
  new: "New", paused: "Paused", selected: "Selected", ready: "Ready", in_sequence: "In outreach", replied: "Replied", handed_off: "With sales", suppressed: "Unsubscribed", do_not_contact: "Do not contact",
};

/** Last resort for a value without a label: "needs_human_reply" → "Needs human reply". */
export function humanize(v: string | null | undefined): string {
  if (!v) return "—";
  const s = v.replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const reviewLabel = (t: string) => (REVIEW_TYPE_LABEL as Record<string, string>)[t] ?? humanize(t);
