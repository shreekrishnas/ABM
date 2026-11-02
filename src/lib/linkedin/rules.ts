// Fixed rules for LinkedIn messaging. The AI drafts and reads; these decide what may happen.
//   • Outreach block: suppressed, do-not-contact, handed to sales, closed or "not interested" → no new messages.
//   • Follow-up eligibility: a follow-up is offered only when the interval has passed since the last
//     message, fewer than the maximum follow-ups are unanswered, a person confirmed the conversation
//     is up to date (no reply missing), there was no email reply, and there's a fact not yet used.
//   • Draft checks: claims cite stored facts, length within LinkedIn limits, no banned claims, no
//     invented familiarity or agreement, not a repeat of an earlier message.

import type { Stage } from "@/lib/journey/stages";
import type { MessageKind, ReplyAnalysis } from "./types";

const DAY = 86_400_000;

export interface OutreachState {
  contactState: string;
  accountDoNotContact: boolean;
  accountStage: string;
  stage: Stage;
}

/** Why no new outreach may be drafted for this person (null = allowed). */
export function outreachBlock(s: OutreachState): string | null {
  if (s.contactState === "suppressed" || s.contactState === "do_not_contact" || s.accountDoNotContact) return "This person asked not to be contacted (or is suppressed): no further outreach";
  if (s.contactState === "handed_off" || ["MQA", "OPPORTUNITY", "CUSTOMER"].includes(s.accountStage)) return "The account is with sales: routine outreach is paused; the account owner leads the conversation";
  if (s.accountStage === "DISQUALIFIED") return "The company is ruled out";
  if (["not_interested", "disqualified", "closed_won", "closed_lost"].includes(s.stage)) return "The conversation is closed";
  return null;
}

/** Kinds of message that answer the prospect: allowed while the conversation is live even if a sequence would be paused. */
export const ANSWER_KINDS: MessageKind[] = ["reply_positive", "reply_objection", "reply_info", "referral", "nurture", "custom"];

export interface FollowUpInput {
  stage: Stage;
  now: Date;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  unansweredFollowUps: number;
  upToDateAt: Date | null;
  emailReplied: boolean;
  unusedFacts: number;
  followUpDays: number;
  maxUnanswered: number;
}

export interface Eligibility { eligible: boolean; reason: string; dueOn: Date | null; stop: boolean }

export function followUpEligibility(f: FollowUpInput): Eligibility {
  const due = f.lastOutboundAt ? new Date(f.lastOutboundAt.getTime() + f.followUpDays * DAY) : null;
  if (f.emailReplied) return { eligible: false, reason: "They replied by email: continue that conversation instead of a LinkedIn follow-up", dueOn: null, stop: false };
  if (f.lastInboundAt && f.lastOutboundAt && f.lastInboundAt > f.lastOutboundAt) return { eligible: false, reason: "They replied after our last message: answer the reply, not a follow-up", dueOn: null, stop: false };
  if (!f.lastOutboundAt) return { eligible: false, reason: "Nothing sent yet: start with a connection request or first message", dueOn: null, stop: false };
  if (!["connection_accepted", "follow_up_sent", "replied_neutral"].includes(f.stage)) return { eligible: false, reason: "Follow-ups apply after the connection is accepted and a message is unanswered", dueOn: null, stop: false };
  if (f.unansweredFollowUps >= f.maxUnanswered) return { eligible: false, reason: `${f.unansweredFollowUps} follow-up${f.unansweredFollowUps === 1 ? "" : "s"} unanswered (the limit is ${f.maxUnanswered}): stop here, or wait for a new buying signal`, dueOn: null, stop: true };
  if (due && f.now < due) return { eligible: false, reason: `Too soon: follow-ups wait ${f.followUpDays} days after the last message`, dueOn: due, stop: false };
  if (!f.upToDateAt || f.upToDateAt < f.lastOutboundAt) return { eligible: false, reason: "Confirm the LinkedIn conversation is up to date (no reply you haven't recorded) before a follow-up", dueOn: due, stop: false };
  if (f.unusedFacts === 0) return { eligible: false, reason: "No new, relevant fact to add since the last message: wait for a new signal rather than repeat yourself", dueOn: null, stop: false };
  return { eligible: true, reason: `Due: ${f.followUpDays}+ days since the last message, no reply recorded, and there's something new to add`, dueOn: due, stop: false };
}

/** Lower-case word set for repetition checks. */
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));

export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

const FAMILIARITY = /\b(as we discussed|as discussed|as promised|per our (call|conversation|chat)|great (talking|speaking|chatting) (to|with) you|following up on our (call|meeting)|you (agreed|mentioned you('d| would))|we spoke|our last call|good to see you again)\b/i;

export interface DraftCheck { check: string; pass: boolean; detail: string }

export function checkDraft(d: { body: string; claims: { text: string; factIds: string[] }[] }, ctx: { kind: MessageKind; usableIds: Set<string>; maxChars: number; banned: string[]; previous: string[]; conversationHasReply: boolean; commitments: string[] }): DraftCheck[] {
  const out: DraftCheck[] = [];
  const unsupported = d.claims.filter((c) => !c.factIds.length || c.factIds.some((id) => !ctx.usableIds.has(id)));
  out.push({ check: "Every statement about them cites a stored fact", pass: unsupported.length === 0, detail: unsupported.length ? `Not backed by research: “${unsupported[0].text.slice(0, 90)}”` : `${d.claims.length} statement(s), each citing a verified or probable fact` });
  out.push({ check: `Length within ${ctx.maxChars} characters`, pass: d.body.length <= ctx.maxChars && d.body.trim().length >= 20, detail: `${d.body.length} characters` });
  const banned = ctx.banned.find((b) => b && d.body.toLowerCase().includes(b.toLowerCase()));
  out.push({ check: "No banned claims", pass: !banned, detail: banned ? `Contains “${banned}”` : "None" });
  const fam = d.body.match(FAMILIARITY);
  const familiarityOk = !fam || (ctx.conversationHasReply && ctx.commitments.length > 0);
  out.push({ check: "No invented familiarity or agreement", pass: familiarityOk, detail: familiarityOk ? "None" : `Says “${fam![0]}” but no such conversation or commitment is recorded` });
  const repeat = ctx.previous.find((p) => similarity(p, d.body) >= 0.6);
  out.push({ check: "Not a repeat of an earlier message", pass: !repeat, detail: repeat ? "Too close to a message already sent" : "New content" });
  if (ctx.kind === "connection_request") out.push({ check: "No pitch in a connection request", pass: !/\b(demo|pricing|book a call|schedule a call|15 minutes|quick call)\b/i.test(d.body), detail: "A connection note introduces; it doesn't ask for a meeting" });
  return out;
}

const STOP = /\b(stop (messaging|contacting|emailing)|don'?t (contact|message|email) me|do not (contact|message|email)|unsubscribe|remove me|take me off|not interested,? (please|thanks)? ?stop|leave me alone)\b/i;
const EXPLICIT = /\b(interested|let'?s (talk|connect|discuss|set up|schedule)|schedule|set up a call|book a (call|meeting|demo)|send (me )?(the )?(details|deck|pricing|proposal|more info)|share (the )?(details|deck|pricing)|demo|call (me|next week|tomorrow)|happy to (talk|chat|discuss)|keen to)\b/i;

/** Code has the last word on what a reply means for outreach: a stop request always stops; "explicit interest" needs words that say so. */
export function guardAnalysis(a: ReplyAnalysis, text: string): ReplyAnalysis {
  const out = { ...a };
  if (STOP.test(text)) {
    out.stopRequested = true;
    out.type = "stop_request";
    out.intent = "none";
    out.continueOutreach = false;
    out.nextKind = null;
    out.suggestedStage = "not_interested";
    out.recommendedAction = "Stop all outreach to this person on every channel. No reply needed beyond a brief acknowledgement, if any.";
  }
  if (out.intent === "explicit" && !EXPLICIT.test(text)) {
    out.intent = "possible";
    if (["interested", "call_scheduled", "demo_scheduled", "opportunity"].includes(out.suggestedStage)) out.suggestedStage = "replied_neutral";
  }
  if (out.stopRequested) out.continueOutreach = false;
  return out;
}
