// Instructions for the LinkedIn writer, reply reader and conversation summariser.

import { z } from "zod";
import { JOURNEY_STAGES } from "@/lib/journey/stages";
import { MESSAGE_KINDS, REPLY_TYPES, type LinkedInDraftInput, type MessageKind } from "./types";

const PURPOSE: Record<MessageKind, string> = {
  connection_request: "A connection request note: one or two sentences saying why connecting makes sense for THEM (their role, one relevant fact). No pitch, no meeting ask, no link.",
  initial: "The first message after they accepted: open with the single most relevant research-backed angle for their role, one sentence on how the seller helps with it, and one easy question. No meeting ask yet unless the signal is strong.",
  follow_up: "A follow-up to an unanswered message: add ONE new, useful point (a different fact or angle from earlier messages), connect it to their responsibilities, and close with a light question. Never repeat an earlier point or guilt-trip about no reply.",
  reply_positive: "They expressed interest: thank them briefly, answer what they asked, and propose a concrete next step (a short call with two time options, or the material they asked for).",
  reply_objection: "They raised a concern: acknowledge it plainly, answer it honestly using approved material only, and offer a low-pressure next step. Don't argue.",
  reply_info: "They asked for information: answer accurately using ONLY approved client material; if something isn't covered there, say you'll confirm it rather than guessing.",
  referral: "An introduction to the person they referred you to: say who referred you (from the conversation), why their role matters, and one relevant point.",
  nurture: "They asked to talk later: a short, respectful note that acknowledges the timing, leaves one useful thought, and confirms when you'll reconnect.",
  custom: "A message following the person's note exactly, within the rules.",
};

export function linkedInSystem(i: LinkedInDraftInput): string {
  return [
    `You write LinkedIn messages for ${i.seller.name}. A person reviews, edits and sends every message by hand.`,
    (i.tone.length ? i.tone : ["Plain, specific, human; no hype, no emojis"]).join(". ") + ".",
    `Task: ${PURPOSE[i.kind]}`,
    `Hard rules: at most ${i.maxChars} characters. Every sentence about the prospect or their company must come from FACTS and be listed in claims with the fact ids; never invent projects, figures, relationships, meetings or agreements. Don't claim familiarity ("great speaking with you") unless the CONVERSATION shows it. Describe the seller only with the SELLER and APPROVED material. A pain is a hypothesis: phrase it as a question or "teams in your role often…". Never use anything but FACTS ids in claims; claims lists only sentences about the prospect.`,
    i.bannedClaims.length ? `Never claim: ${i.bannedClaims.join("; ")}.` : "",
    i.usedAngles.length ? `Angles already used (choose a different one): ${i.usedAngles.join(" | ")}.` : "",
    `Return {"body":"...","claims":[{"text":"<sentence from body>","factIds":["<id>"]}],"why":"<one sentence: why this message now>","angle":"<the angle in a few words>"}`,
  ].filter(Boolean).join("\n");
}

export function linkedInUser(i: LinkedInDraftInput): string {
  return [
    `PROSPECT: ${i.contact.name}${i.contact.title ? `, ${i.contact.title}` : ""} at ${i.company}${i.industry ? ` (${i.industry})` : ""}. Role in the buying group: ${i.contact.role}${i.contact.persona ? ` · persona: ${i.contact.persona}` : ""}.`,
    `FACTS:\n${i.facts.map((f) => `${f.id}: ${f.claim}`).join("\n") || "none (write without any claim about the company)"}`,
    i.whyNow ? `WHY NOW: ${i.whyNow}` : "",
    i.angle ? `SUGGESTED ANGLE: pain (hypothesis) = ${i.angle.pain}; capability = ${i.angle.capability}${i.angle.proofPoint ? `; proof point = ${i.angle.proofPoint}` : ""}` : "",
    `SELLER: ${i.seller.summary}\nPITCH: ${i.seller.pitch}\nCTA style: ${i.seller.cta}`,
    i.approved.length ? `APPROVED MATERIAL (may be stated):\n- ${i.approved.join("\n- ")}` : "",
    i.history.length ? `CONVERSATION (oldest first):\n${i.history.map((h) => `[${h.at}] ${h.direction === "out" ? "US" : "THEM"} (${h.kind}): ${h.text}`).join("\n")}` : "CONVERSATION: none yet",
    i.summary ? `SUMMARY: ${i.summary}` : "",
    i.note ? `PERSON'S NOTE: ${i.note}` : "",
  ].filter(Boolean).join("\n\n");
}

export const draftSchema = z.object({
  body: z.string().min(10).max(2000),
  claims: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ text: z.string(), factIds: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string())) })).max(8)),
  why: z.preprocess((v) => (v == null ? "" : String(v)), z.string().max(400)),
  angle: z.preprocess((v) => (v == null ? "" : String(v)), z.string().max(120)),
});

export const replySchema = z.object({
  type: z.enum(REPLY_TYPES).catch("neutral"),
  intent: z.enum(["explicit", "possible", "none"]).catch("none"),
  futureOpportunity: z.boolean().catch(false),
  questions: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string().max(300)).max(8)),
  mentions: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string().max(200)).max(8)),
  commitments: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string().max(200)).max(6)),
  stopRequested: z.boolean().catch(false),
  continueOutreach: z.boolean().catch(true),
  recommendedAction: z.string().max(400).catch(""),
  nextKind: z.enum(MESSAGE_KINDS).nullable().catch(null),
  suggestedStage: z.enum(JOURNEY_STAGES).catch("replied_neutral"),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  summary: z.string().max(500).catch(""),
});

export const REPLY_SYSTEM =
  "You read a prospect's LinkedIn reply in the context of the conversation and say what it MEANS for the next step. Read the meaning, not the tone. " +
  "type: positive_interest | information_request | objection | existing_vendor | timing_later | referral | not_interested | stop_request | neutral | out_of_office. " +
  "intent: explicit ONLY when they say they are interested or ask for a call, demo, pricing or details; possible when a future opportunity is suggested (e.g. 'we may evaluate next year'); otherwise none. Mentioning a technology or initiative is NOT buying intent. " +
  "questions = what they asked that needs an answer. mentions = budgets, vendors, timelines or projects they named. commitments = anything either side explicitly agreed (a call, material, a date). " +
  "stopRequested = true if they ask not to be contacted. continueOutreach = whether more outreach is appropriate. recommendedAction = what the user should do next, in one or two sentences. " +
  "nextKind = the message to send next (reply_positive, reply_objection, reply_info, referral, nurture) or null. suggestedStage = the journey stage this reply sets. followUpOn = YYYY-MM-DD if they asked to talk at a later time, else null. summary = one sentence.";

export const summarySchema = z.object({
  stage: z.string().max(80).catch(""),
  lastInteraction: z.string().max(300).catch(""),
  topics: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string().max(120)).max(8)),
  concerns: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string().max(200)).max(6)),
  interest: z.string().max(200).catch(""),
  commitments: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string().max(200)).max(6)),
  nextStep: z.string().max(300).catch(""),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
});

export const SUMMARY_SYSTEM =
  "You keep a short, factual summary of a LinkedIn conversation for a salesperson. Use ONLY what the recorded messages say; never infer agreements. " +
  "Return stage (where it stands), lastInteraction (who said what, when), topics discussed, concerns raised by the prospect, interest (explicit, possible, none, with a few words), commitments (explicit only), nextStep and nextDate (YYYY-MM-DD or null).";
