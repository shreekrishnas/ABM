// Priority: one number for "who first", built from four parts the team can see and tune:
// intent (is something happening now), fit (do they match the seller's ICP), value
// (how big the opportunity is) and timing (how fresh the newest signal is).
// Plus the next best action for each company, so the table says what to do, not just who.

import type { IntentReading } from "./intent";
import { seller } from "@/lib/seller";

const DAY = 86_400_000;

export interface PriorityParts {
  intent: number;
  fit: number;
  value: number;
  timing: number;
  weights: { intent: number; fit: number; value: number; timing: number };
}

export const DEFAULT_PRIORITY_WEIGHTS = { intent: 40, fit: 30, value: 20, timing: 10 };

/** Company size on a log scale: 1,000 → 0, 5,000 → 30, 15,000 → 51, 50,000 → 74, 200,000+ → 100. */
export function valueScore(employees: number | null | undefined): number {
  if (employees == null || employees <= 0) return 35;
  return Math.round(Math.max(0, Math.min(100, (100 * Math.log10(employees / 1000)) / Math.log10(200))));
}

/** Freshness of the newest positive signal: today → 100, 30 days → 50, 90 days → 13. */
export function timingScore(reading: Pick<IntentReading, "signals"> | null | undefined, now = new Date()): number {
  const dates = (reading?.signals ?? []).filter((s) => s.strength > 0 && s.at).map((s) => new Date(s.at as Date).getTime());
  if (!dates.length) return 0;
  const days = Math.max(0, (now.getTime() - Math.max(...dates)) / DAY);
  return Math.round(100 * Math.pow(0.5, days / 30));
}

export function priorityFor(a: { fitScore: number | null; employees: number | null }, reading: Pick<IntentReading, "score" | "signals"> | null, now = new Date()): { score: number; parts: PriorityParts } {
  const weights = seller().icp.priorityWeights ?? DEFAULT_PRIORITY_WEIGHTS;
  const parts = { intent: reading?.score ?? 0, fit: a.fitScore ?? 50, value: valueScore(a.employees), timing: timingScore(reading, now) };
  const total = weights.intent + weights.fit + weights.value + weights.timing || 1;
  const score = Math.round((parts.intent * weights.intent + parts.fit * weights.fit + parts.value * weights.value + parts.timing * weights.timing) / total);
  return { score, parts: { ...parts, weights } };
}

// ── Next best action ──

export interface ActionState {
  tier: string | null;
  level: "hot" | "warm" | "cold";
  stage: string;
  pipelineStatus: string;
  disqualified: boolean;
  openHandoff: boolean;
  pendingDrafts: number;
  people: number;
  reachable: number; // people with a usable email
  emailed: boolean;
  replied: boolean;
  linkedinConnected: boolean;
  /** Pricing or demo page visit in the last 14 days. */
  strongVisit: boolean;
  /** The person who visited, when known. */
  visitor: string | null;
}

export interface NextAction {
  text: string;
  why: string;
  href: "review" | "handoffs" | "company" | "people";
}

export function nextBestAction(s: ActionState): NextAction {
  if (s.disqualified) return { text: "No action", why: "Outside the targeting rule or ruled out", href: "company" };
  if (s.openHandoff) return { text: "Pick up the hand-off", why: "Ready for sales; outreach is paused", href: "handoffs" };
  if (s.stage === "MQA" || s.stage === "OPPORTUNITY") return { text: "Sales is working it", why: s.strongVisit ? "Handed to sales; back on pricing or demo pages, so tell the rep" : "Handed to sales; automated outreach is paused", href: "company" };
  if (s.replied) return { text: "Answer the reply", why: "They responded", href: "people" };
  if (s.pendingDrafts) return { text: `Approve ${s.pendingDrafts} email${s.pendingDrafts > 1 ? "s" : ""}`, why: "Drafted and checked; waiting for you", href: "review" };
  if (s.strongVisit && s.emailed) return { text: s.visitor ? `Call ${s.visitor}` : "Call the champion", why: "Looked at pricing or demo pages after our email", href: "people" };
  if (s.strongVisit) return { text: "Start outreach now", why: "Looking at pricing or demo pages", href: "company" };
  if (s.pipelineStatus === "queued" || s.pipelineStatus === "running") return { text: "Research in progress", why: "The brain is working on it", href: "company" };
  if (s.people === 0) return { text: "Find the right people", why: "No contacts yet", href: "company" };
  if (s.reachable === 0) return { text: s.tier === "T1" ? "Send a LinkedIn connection" : "Find an email address", why: "No usable email for anyone here", href: "people" };
  if (s.level === "hot" && !s.linkedinConnected && s.tier === "T1") return { text: "Send a LinkedIn connection", why: "Hot T1 account: add a second channel", href: "people" };
  if (s.stage === "WATCH") return { text: "Watch", why: "Waiting for a better moment", href: "company" };
  if (s.level === "cold") return { text: "Nurture", why: "No buying signals yet", href: "company" };
  return { text: "Let the sequence run", why: "Emails are on schedule", href: "company" };
}
