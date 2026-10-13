// The 17 People stages from the agreed Phase 1 design, in dropdown order.
// Client-safe: no database imports.

export const JOURNEY_STAGES = [
  "not_contacted", "connection_sent", "connection_accepted", "follow_up_sent", "replied_neutral", "details_requested",
  "details_shared", "interested", "nurture", "referred", "not_interested", "disqualified", "call_scheduled",
  "demo_scheduled", "opportunity", "closed_won", "closed_lost",
] as const;
export type Stage = (typeof JOURNEY_STAGES)[number];

export type StageGroup = "outreach" | "response" | "qualification" | "outcome";

export interface StageInfo {
  key: Stage;
  n: number; // dropdown number
  label: string;
  /** The stage as part of a sentence: "Asha Mehta asked for details on LinkedIn with Sender 1". */
  phrase: string;
  group: StageGroup;
  useWhen: string;
  next: string;
  /** Progress rank on the main path. Side stages (nurture, referred, not interested, disqualified) have none. */
  rank: number | null;
  color: string;
}

export const STAGE_INFO: Record<Stage, StageInfo> = {
  not_contacted: { key: "not_contacted", n: 1, label: "Not Contacted", phrase: "hasn't been contacted", group: "outreach", useWhen: "No connection request has been sent.", next: "Send connection request.", rank: 0, color: "#7C8A84" },
  connection_sent: { key: "connection_sent", n: 2, label: "Connection Sent", phrase: "has a connection request pending", group: "outreach", useWhen: "Connection request sent but not accepted.", next: "Wait for acceptance.", rank: 1, color: "#6B8FB0" },
  connection_accepted: { key: "connection_accepted", n: 3, label: "Connection Accepted", phrase: "accepted a connection request", group: "outreach", useWhen: "Request accepted; no meaningful response yet.", next: "Send first follow-up.", rank: 2, color: "#3D6FA8" },
  follow_up_sent: { key: "follow_up_sent", n: 4, label: "Follow-up Sent", phrase: "has had follow-ups but no reply", group: "outreach", useWhen: "One or more follow-ups sent without a meaningful response.", next: "Send the next follow-up.", rank: 3, color: "#2F5D8A" },
  replied_neutral: { key: "replied_neutral", n: 5, label: "Replied – Neutral", phrase: "replied", group: "response", useWhen: "Reply received without clear business intent.", next: "Send a relevant introduction or clarify need.", rank: 4, color: "#2F7D6D" },
  details_requested: { key: "details_requested", n: 6, label: "Details Requested", phrase: "asked for details", group: "response", useWhen: "Person asked for information.", next: "Share requested details.", rank: 5, color: "#1F8A70" },
  details_shared: { key: "details_shared", n: 7, label: "Details Shared", phrase: "was sent the details they asked for", group: "qualification", useWhen: "Requested information has been sent.", next: "Follow up after the defined period.", rank: 6, color: "#3F9A5A" },
  interested: { key: "interested", n: 8, label: "Interested", phrase: "is interested", group: "qualification", useWhen: "Person clearly expressed interest.", next: "Schedule a call or advance the discussion.", rank: 7, color: "#B7791F" },
  nurture: { key: "nurture", n: 9, label: "Nurture or Future", phrase: "asked to talk later", group: "response", useWhen: "Possible future need or later follow-up required.", next: "Set a future follow-up date.", rank: null, color: "#8A6A2E" },
  referred: { key: "referred", n: 10, label: "Referred", phrase: "referred us to a colleague", group: "response", useWhen: "Person redirected outreach to another contact.", next: "Create or link the referred contact.", rank: null, color: "#5A7A8C" },
  not_interested: { key: "not_interested", n: 11, label: "Not Interested", phrase: "said no", group: "response", useWhen: "Person clearly declined or confirmed no requirement.", next: "Record the reason and close outreach.", rank: null, color: "#A3AFAA" },
  disqualified: { key: "disqualified", n: 12, label: "Disqualified", phrase: "was ruled out", group: "response", useWhen: "Wrong, invalid or outdated contact.", next: "Record the reason and find another contact.", rank: null, color: "#C2412D" },
  call_scheduled: { key: "call_scheduled", n: 13, label: "Call Scheduled", phrase: "agreed to a call", group: "qualification", useWhen: "Person agreed to a call.", next: "Complete the call.", rank: 8, color: "#C2632D" },
  demo_scheduled: { key: "demo_scheduled", n: 14, label: "Demo Scheduled", phrase: "booked a demo", group: "qualification", useWhen: "A demonstration has been confirmed.", next: "Conduct the demo.", rank: 9, color: "#B4502A" },
  opportunity: { key: "opportunity", n: 15, label: "Opportunity", phrase: "is in an open deal", group: "outcome", useWhen: "A genuine requirement or commercial discussion exists.", next: "Progress the opportunity.", rank: 10, color: "#9A5B13" },
  closed_won: { key: "closed_won", n: 16, label: "Closed – Won", phrase: "became a customer", group: "outcome", useWhen: "Opportunity converted successfully.", next: "Complete handover or onboarding.", rank: 11, color: "#0B6E5F" },
  closed_lost: { key: "closed_lost", n: 17, label: "Closed – Lost", phrase: "was closed as lost", group: "outcome", useWhen: "Qualified opportunity did not proceed.", next: "Record the loss reason.", rank: 11, color: "#4B5A55" },
};

export const OUTREACH: readonly Stage[] = ["not_contacted", "connection_sent", "connection_accepted", "follow_up_sent"];
/** Stages where outreach has ended; no more connection requests or follow-ups are suggested. */
export const CLOSED: readonly Stage[] = ["not_interested", "disqualified", "closed_won", "closed_lost"];

export function stageLabel(stage: Stage, followUpCount = 0): string {
  if (stage === "follow_up_sent") return `Follow-up Sent (${followUpCount >= 4 ? "4+" : Math.max(1, followUpCount)})`;
  return STAGE_INFO[stage].label;
}

/** "Replied – Neutral", "replied neutral", "Follow-up Sent (2)", "8" → the stage key. */
export function parseStage(input: string | null | undefined): Stage | null {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/\(.*\)/, "").replace(/[–—_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^\d+$/.test(s)) return JOURNEY_STAGES.at(Number(s) - 1) ?? null;
  const norm = (x: string) => x.toLowerCase().replace(/[–—_-]+/g, " ").replace(/\s+/g, " ").trim();
  const hit = JOURNEY_STAGES.find((k) => norm(STAGE_INFO[k].label) === s || norm(k) === s);
  if (hit) return hit;
  if (s === "nurture" || s === "future") return "nurture";
  if (s === "won") return "closed_won";
  if (s === "lost") return "closed_lost";
  return null;
}
