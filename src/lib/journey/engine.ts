// Stage logic for a person's journey with one sender profile. Pure functions:
// every update path (CSV import, manual update, bulk update, agent-assisted reply)
// goes through applyActivity, so the rules hold everywhere.
//
//   • Reply count is a metric; the reply's MEANING sets the stage.
//   • Follow-ups are one stage with a counter: Follow-up Sent (1), (2), (3), (4+).
//   • Once a person is past outreach (Details Shared, Interested, Opportunity…),
//     another follow-up updates Last Engagement and the count but never moves them back.
//   • A manual stage choice always wins (user control).

import { CLOSED, OUTREACH, STAGE_INFO, stageLabel, type Stage } from "./stages";

export interface JourneyState {
  stage: Stage;
  followUpCount: number;
  replyCount: number;
  lastEngagementAt: Date | null;
  lastEngagement: string | null;
}

export type Activity =
  | { type: "connection_sent"; at: Date }
  | { type: "connection_accepted"; at: Date }
  | { type: "follow_up_sent"; at: Date }
  /** `meaning` = the stage this reply sets (suggested by rules or the AI, confirmed by a person). */
  | { type: "reply"; at: Date; text: string; meaning: Stage }
  | { type: "details_shared"; at: Date; detail?: string }
  | { type: "call_scheduled"; at: Date; detail?: string }
  | { type: "demo_scheduled"; at: Date; detail?: string }
  | { type: "call_logged"; at: Date; detail?: string }
  | { type: "stage_set"; at: Date; stage: Stage; detail?: string }
  | { type: "note"; at: Date; text: string };

export interface AppliedEvent {
  type: Activity["type"];
  fromStage: Stage;
  toStage: Stage;
  detail: string | null;
  occurredAt: Date;
}

const rank = (s: Stage) => STAGE_INFO[s].rank;
const isSide = (s: Stage) => STAGE_INFO[s].rank == null;
const isFinal = (s: Stage) => s === "closed_won" || s === "closed_lost";

/** Move forward on the main path only (side stages may move onto it; final stages never move). */
function advance(current: Stage, to: Stage): Stage {
  if (isFinal(current)) return current;
  if (current === "not_interested" || current === "disqualified") return current;
  if (isSide(current)) return to;
  return (rank(to) ?? -1) > (rank(current) ?? -1) ? to : current;
}

export function applyActivity(s: JourneyState, a: Activity): { next: JourneyState; event: AppliedEvent } {
  let stage = s.stage;
  let { followUpCount, replyCount } = s;
  let detail: string | null = null;
  let engagement: string;

  switch (a.type) {
    case "connection_sent":
      if (OUTREACH.includes(stage)) stage = advance(stage, "connection_sent");
      engagement = "Connection request sent";
      break;
    case "connection_accepted":
      if (OUTREACH.includes(stage)) stage = advance(stage, "connection_accepted");
      engagement = "Connection accepted";
      break;
    case "follow_up_sent":
      followUpCount += 1;
      // Past outreach: count it, never move the person backwards.
      if (OUTREACH.includes(stage)) stage = "follow_up_sent";
      engagement = `Follow-up ${followUpCount} sent`;
      detail = `Follow-up ${followUpCount}`;
      break;
    case "reply": {
      replyCount += 1;
      const m = a.meaning;
      if (isFinal(stage)) {
        // Deal already closed: record the message, keep the outcome.
      } else if (isSide(m)) {
        stage = m; // nurture / referred / not interested / disqualified: the meaning decides
      } else if (m === "replied_neutral") {
        if (OUTREACH.includes(stage)) stage = m; // a "hi" never pulls a qualified person back
      } else if (stage === "not_interested" || stage === "disqualified" || isSide(stage)) {
        stage = m; // e.g. someone who said "not now" now asks for details
      } else {
        stage = advance(stage, m);
      }
      engagement = `Replied: ${a.text.replace(/\s+/g, " ").slice(0, 80)}`;
      detail = a.text.slice(0, 2000);
      break;
    }
    case "details_shared":
      if (!isFinal(stage) && stage !== "not_interested" && stage !== "disqualified") stage = isSide(stage) ? "details_shared" : advance(stage, "details_shared");
      engagement = "Details shared";
      detail = a.detail ?? null;
      break;
    case "call_scheduled":
    case "demo_scheduled":
      if (!isFinal(stage)) stage = isSide(stage) ? a.type : advance(stage, a.type);
      engagement = a.type === "call_scheduled" ? "Call scheduled" : "Demo scheduled";
      detail = a.detail ?? null;
      break;
    case "call_logged":
      engagement = "Call made";
      detail = a.detail ?? null;
      break;
    case "stage_set":
      stage = a.stage;
      engagement = `Stage set to ${STAGE_INFO[a.stage].label}`;
      detail = a.detail ?? null;
      break;
    case "note":
      engagement = "Note added";
      detail = a.text.slice(0, 2000);
      break;
  }

  // Backfilled (older) activity never replaces a more recent last engagement.
  const newer = !s.lastEngagementAt || a.at.getTime() >= s.lastEngagementAt.getTime();
  const next: JourneyState = {
    stage,
    followUpCount,
    replyCount,
    lastEngagementAt: newer && a.type !== "note" ? a.at : s.lastEngagementAt,
    lastEngagement: newer && a.type !== "note" ? engagement : s.lastEngagement,
  };
  return { next, event: { type: a.type, fromStage: s.stage, toStage: stage, detail, occurredAt: a.at } };
}

export const JOURNEY_RULES = {
  followUpGapDays: 5,
  maxFollowUps: 4,
  detailsFollowUpDays: 3,
  connectionStaleDays: 14,
};

const DAY = 86_400_000;
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Next suggested action for one journey. */
export function nextAction(s: JourneyState, now = new Date()): { text: string; dueAt: Date | null } {
  const last = s.lastEngagementAt;
  const after = (days: number) => (last ? new Date(last.getTime() + days * DAY) : now);
  switch (s.stage) {
    case "not_contacted":
      return { text: "Send connection request", dueAt: now };
    case "connection_sent": {
      const stale = after(JOURNEY_RULES.connectionStaleDays);
      return stale <= now ? { text: `Not accepted in ${JOURNEY_RULES.connectionStaleDays} days — withdraw, or try email or another contact`, dueAt: stale } : { text: "Wait for acceptance", dueAt: stale };
    }
    case "connection_accepted":
      return { text: "Send first follow-up", dueAt: now };
    case "follow_up_sent": {
      if (s.followUpCount >= JOURNEY_RULES.maxFollowUps) return { text: `No response after ${s.followUpCount} follow-ups — move to Nurture or close`, dueAt: now };
      const due = after(JOURNEY_RULES.followUpGapDays);
      return due <= now ? { text: `Send follow-up ${s.followUpCount + 1}`, dueAt: due } : { text: `Follow-up ${s.followUpCount + 1} due ${fmt(due)}`, dueAt: due };
    }
    case "details_shared": {
      const due = after(JOURNEY_RULES.detailsFollowUpDays);
      return due <= now ? { text: "Follow up on the details shared", dueAt: due } : { text: `Follow up on details ${fmt(due)}`, dueAt: due };
    }
    default:
      return { text: STAGE_INFO[s.stage].next.replace(/\.$/, ""), dueAt: CLOSED.includes(s.stage) ? null : now };
  }
}

/**
 * Eligible to call: we hold a phone number, the person has not opted out, they have
 * engaged (accepted the connection or replied), and outreach has not ended.
 */
export function eligibleToCall(p: { phone: string | null; suppressed: boolean; doNotContact: boolean }, stage: Stage | null): { ok: boolean; reason: string } {
  if (!p.phone) return { ok: false, reason: "No phone number" };
  if (p.suppressed || p.doNotContact) return { ok: false, reason: "Opted out / do not contact" };
  if (!stage) return { ok: false, reason: "No journey yet" };
  if (CLOSED.includes(stage)) return { ok: false, reason: `${STAGE_INFO[stage].label} — outreach closed` };
  if (stage === "not_contacted" || stage === "connection_sent") return { ok: false, reason: "Not engaged yet (connection not accepted)" };
  return { ok: true, reason: `Engaged · ${stageLabel(stage)}` };
}

/** Rule-based reply meaning, from the agreed examples. The AI suggestion uses the same stages. */
export function classifyReplyRules(text: string): { stage: Stage; reason: string } {
  const t = text.toLowerCase();
  if (/no longer (work|with)|left (the )?(company|organi[sz]ation)|not with .* anymore|moved on from/.test(t)) return { stage: "disqualified", reason: "Says they no longer work there" };
  if (/(please )?(contact|reach out to|speak (to|with)|connect with|talk to|get in touch with)\b.*\b(our|the|my)\b|not the right person|wrong person|handles this|is the right person/.test(t)) return { stage: "referred", reason: "Points to another contact" };
  if (/not interested|no (current )?(requirement|need)|do(n't| not) have (a |any )?(current )?(requirement|need)|not looking|no thanks|not required|we are (all )?set|please remove/.test(t)) return { stage: "not_interested", reason: "Declines or has no requirement" };
  if (/(share|send)( me| us)? (more )?(details|info|information|brochure|deck|catalog|pricing|case stud)|more (details|information)|can you (share|send)/.test(t)) return { stage: "details_requested", reason: "Asks for information" };
  if (/(will|i'?ll|let me) (check|revert|get back|come back|inform)|next (quarter|year|month)|not (right )?now|later this|in a few (weeks|months)|circle back|keep in touch|maybe later/.test(t)) return { stage: "nurture", reason: "Possible later need" };
  if (/\b(demo)\b.*\b(on|at|scheduled|booked|confirmed)\b/.test(t)) return { stage: "demo_scheduled", reason: "Confirms a demo" };
  if (/\b(call|meeting)\b.*\b(scheduled|booked|confirmed)\b|see you (on|at)|invite (sent|accepted)/.test(t)) return { stage: "call_scheduled", reason: "Confirms a call" };
  if (/interested|let'?s (talk|connect|discuss|set up|schedule)|sounds (good|interesting)|happy to (talk|discuss|connect)|would like to (know|learn|discuss)|set up a call|book a (call|time)|when are you free/.test(t)) return { stage: "interested", reason: "Expresses interest" };
  return { stage: "replied_neutral", reason: "No clear business intent" };
}
