// LinkedIn messaging: what the AI writer and reader exchange with the platform.

import type { Stage } from "@/lib/journey/stages";

export const MESSAGE_KINDS = ["connection_request", "initial", "follow_up", "reply_positive", "reply_objection", "reply_info", "referral", "nurture", "custom"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const KIND_LABEL: Record<MessageKind, string> = {
  connection_request: "Connection request",
  initial: "First message",
  follow_up: "Follow-up",
  reply_positive: "Reply to interest",
  reply_objection: "Answer an objection",
  reply_info: "Answer a question",
  referral: "Introduction to a referred person",
  nurture: "Nurture message",
  custom: "Custom message",
};

/** LinkedIn's own limits: a connection note is 300 characters; keep messages short enough to read on a phone. */
export const CHAR_LIMIT: Record<MessageKind, number> = { connection_request: 300, initial: 700, follow_up: 600, reply_positive: 700, reply_objection: 700, reply_info: 900, referral: 600, nurture: 500, custom: 900 };

export interface LinkedInDraftInput {
  kind: MessageKind;
  company: string;
  industry: string | null;
  contact: { name: string; firstName: string | null; title: string | null; role: string; persona: string | null };
  /** Research facts the message may cite (verified or probable, fresh). */
  facts: { id: string; claim: string }[];
  /** The brief's suggested angle for this person, if any. */
  angle: { pain: string; capability: string; proofPoint: string | null } | null;
  whyNow: string | null;
  seller: { name: string; summary: string; pitch: string; cta: string };
  /** Approved client material (proof points, product notes, objection answers) usable as-is. */
  approved: string[];
  tone: string[];
  bannedClaims: string[];
  /** The conversation so far, oldest first. */
  history: { direction: "out" | "in"; kind: string; text: string; at: string }[];
  /** Angles already used in earlier messages (do not repeat them). */
  usedAngles: string[];
  summary: string | null;
  /** What a person asked for ("mention the plant opening", "shorter"). */
  note: string | null;
  maxChars: number;
}

export interface LinkedInDraftOutput {
  body: string;
  /** Sentences about the prospect, each with the fact ids they rest on. */
  claims: { text: string; factIds: string[] }[];
  why: string;
  angle: string;
}

export const REPLY_TYPES = ["positive_interest", "information_request", "objection", "existing_vendor", "timing_later", "referral", "not_interested", "stop_request", "neutral", "out_of_office"] as const;
export type ReplyType = (typeof REPLY_TYPES)[number];

export interface ReplyAnalysis {
  type: ReplyType;
  /** explicit = they asked for a call, demo, pricing or said they are interested; possible = a future opportunity; none. */
  intent: "explicit" | "possible" | "none";
  futureOpportunity: boolean;
  questions: string[];
  /** Budgets, vendors, timelines or projects the reply mentions. */
  mentions: string[];
  commitments: string[];
  stopRequested: boolean;
  continueOutreach: boolean;
  recommendedAction: string;
  /** The kind of message to send next, if any. */
  nextKind: MessageKind | null;
  suggestedStage: Stage;
  /** YYYY-MM-DD when the reply asks to talk later. */
  followUpOn: string | null;
  summary: string;
}

export interface ConversationSummary {
  stage: string;
  lastInteraction: string;
  topics: string[];
  concerns: string[];
  interest: string;
  commitments: string[];
  nextStep: string;
  nextDate: string | null;
}
