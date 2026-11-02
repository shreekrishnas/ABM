// LinkedIn messaging workspace: the research a message can use, drafting with checks, recording
// what was actually sent, reading replies, the conversation summary and the next action.
// Nothing here sends anything: a person copies the message to LinkedIn and records it.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAdapters } from "@/lib/adapters";
import { seller, sellerFor } from "@/lib/seller";
import { matchPersona } from "@/lib/seller/fit";
import { latestBrief } from "@/lib/brain/strategist";
import { recordActivities } from "@/lib/journey/service";
import { JOURNEY_RULES, type Activity } from "@/lib/journey/engine";
import { STAGE_INFO, type Stage } from "@/lib/journey/stages";
import { isStale } from "@/lib/pipeline/gates";
import { isTriggerKey } from "@/lib/research/keys";
import { ANSWER_KINDS, checkDraft, followUpEligibility, guardAnalysis, outreachBlock, type Eligibility } from "./rules";
import { CHAR_LIMIT, KIND_LABEL, type ConversationSummary, type MessageKind, type ReplyAnalysis } from "./types";

const DAY = 86_400_000;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export async function loadWorkspace(journeyId: string, now = new Date()) {
  const j = await db.journey.findUniqueOrThrow({
    where: { id: journeyId },
    include: { contact: { include: { account: true } }, sender: true, campaign: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  const c = j.contact;
  const a = c.account;
  const sp = (() => { try { return sellerFor(a.sellerId); } catch { return seller(); } })();
  const [evidence, brief, emailReplies] = await Promise.all([
    db.evidence.findMany({ where: { accountId: a.id, supersededById: null, flagged: false, isNegative: false, status: { in: ["verified", "probable"] } }, orderBy: [{ status: "asc" }, { publishedAt: "desc" }], take: 20 }),
    latestBrief(a.id),
    db.reply.findMany({ where: { contactId: c.id }, orderBy: { receivedAt: "desc" }, take: 3 }),
  ]);
  const facts = evidence.filter((e) => !isStale(e.publishedAt, isTriggerKey(e.key) ? "trigger" : "company", now)).slice(0, 10);
  const persona = matchPersona(c.titleNormalized ?? c.title, sp);
  const angle = brief?.personaAngles.find((p) => p.role === c.buyingRole) ?? brief?.personaAngles[0] ?? null;
  const pain = angle ? brief?.painPoints[angle.painIndex] : brief?.painPoints[0];
  const sent = j.messages.filter((m) => m.direction === "out" && m.status === "sent");
  const received = j.messages.filter((m) => m.direction === "in");
  const usedFacts = new Set(sent.flatMap((m) => m.factIds));
  const lastOut = sent.at(-1)?.occurredAt ?? null;
  const lastIn = received.at(-1)?.occurredAt ?? null;
  const unansweredFollowUps = (() => {
    let n = 0;
    for (const m of [...j.messages].reverse()) {
      if (m.direction === "in") break;
      if (m.status === "sent" && m.kind === "follow_up") n++;
    }
    return n;
  })();
  const block = outreachBlock({ contactState: c.state, accountDoNotContact: a.doNotContact, accountStage: a.stage, stage: j.stage as Stage });
  const cfg = sp.linkedin ?? {};
  const eligibility = followUpEligibility({
    stage: j.stage as Stage, now, lastOutboundAt: lastOut, lastInboundAt: lastIn, unansweredFollowUps, upToDateAt: j.upToDateAt,
    emailReplied: emailReplies.some((r) => !lastOut || r.receivedAt > lastOut), unusedFacts: facts.filter((f) => !usedFacts.has(f.id)).length,
    followUpDays: cfg.followUpDays ?? JOURNEY_RULES.followUpGapDays, maxUnanswered: cfg.maxUnansweredFollowUps ?? 2,
  });
  const approved = [...sp.proofPoints.map((p) => p.text), ...sp.products.map((p) => `${p.name}: ${p.what}`), ...(sp.writing?.objections ?? []).map((o) => `If asked "${o.objection}": ${o.answer}`)].slice(0, 12);
  return { j, c, a, sp, facts, usedFacts, persona, angle, pain, brief, sent, received, emailReplies, block, eligibility, approved, lastOut, lastIn };
}

export type Workspace = Awaited<ReturnType<typeof loadWorkspace>>;

/** What to do next, and why — fixed rules over the conversation and the reply reading. */
export function nextStep(w: Workspace, now = new Date()): { text: string; why: string; kind: MessageKind | null; on: Date | null } {
  const stage = w.j.stage as Stage;
  if (w.block) return { text: "No new message", why: w.block, kind: null, on: null };
  const lastIn = w.received.at(-1);
  const answered = lastIn && w.sent.some((m) => (m.occurredAt ?? m.createdAt) > (lastIn.occurredAt ?? lastIn.createdAt));
  if (lastIn && !answered) {
    const an = lastIn.analysis as unknown as ReplyAnalysis | null;
    if (an && !an.continueOutreach) return { text: "Close the conversation politely or stop", why: an.recommendedAction || "They don't want to continue", kind: null, on: null };
    if (an?.followUpOn) return { text: `Reconnect on ${an.followUpOn}`, why: an.recommendedAction, kind: "nurture", on: new Date(`${an.followUpOn}T09:00:00Z`) };
    return { text: an?.nextKind ? `Send: ${KIND_LABEL[an.nextKind].toLowerCase()}` : "Reply to their message", why: an?.recommendedAction || "They replied and are waiting for an answer", kind: an?.nextKind ?? "custom", on: now };
  }
  if (stage === "not_contacted") return { text: "Send a connection request", why: w.facts.length ? "There's research to make the note relevant" : "No research facts yet: keep the note general, or research the company first", kind: "connection_request", on: now };
  if (stage === "connection_sent") {
    const at = w.sent.find((m) => m.kind === "connection_request")?.occurredAt ?? w.j.lastEngagementAt;
    const stale = at && now.getTime() - at.getTime() > JOURNEY_RULES.connectionStaleDays * DAY;
    return { text: stale ? "Request still pending: consider email, or withdraw and retry later" : "Wait for them to accept", why: "Record \"Connection accepted\" when they accept; the first message is drafted from there", kind: null, on: at ? new Date(at.getTime() + JOURNEY_RULES.connectionStaleDays * DAY) : null };
  }
  const acceptedAt = w.j.lastEngagement === "Connection accepted" ? w.j.lastEngagementAt : null;
  const firstSent = w.sent.some((m) => m.kind === "initial" || m.kind === "follow_up" || ANSWER_KINDS.includes(m.kind as MessageKind));
  if (stage === "connection_accepted" && !firstSent) return { text: "Send the first message", why: acceptedAt ? `They accepted on ${day(acceptedAt)}` : "They accepted your request", kind: "initial", on: now };
  const e: Eligibility = w.eligibility;
  if (e.eligible) return { text: "Send a follow-up", why: e.reason, kind: "follow_up", on: now };
  return { text: e.stop ? "Stop the sequence" : e.dueOn ? `Wait until ${day(e.dueOn)}` : "Wait", why: e.reason, kind: null, on: e.dueOn };
}

/** Draft one message; checks run before anyone can approve it. */
export async function generateDraft(journeyId: string, kind: MessageKind, note: string | null, by: string | null) {
  const w = await loadWorkspace(journeyId);
  if (w.block && !ANSWER_KINDS.includes(kind)) throw new Error(w.block);
  if (w.block && /asked not to be contacted|ruled out/.test(w.block)) throw new Error(w.block);
  if (kind === "follow_up" && !w.eligibility.eligible) throw new Error(`Follow-up not offered: ${w.eligibility.reason}`);
  const history = w.j.messages.filter((m) => m.status === "sent" || m.status === "received").map((m) => ({ direction: m.direction as "out" | "in", kind: m.kind, text: m.sentText ?? m.body, at: day(m.occurredAt ?? m.createdAt) }));
  const facts = (kind === "follow_up" ? w.facts.filter((f) => !w.usedFacts.has(f.id)) : w.facts).map((f) => ({ id: f.id, claim: f.claim }));
  const summary = w.j.summary as unknown as ConversationSummary | null;
  const maxChars = CHAR_LIMIT[kind];
  const out = await getAdapters().llm.draftLinkedIn({
    kind, company: w.a.name, industry: w.a.industry,
    contact: { name: w.c.fullName, firstName: w.c.firstName, title: w.c.titleNormalized ?? w.c.title, role: w.c.buyingRole.replace("_", " "), persona: w.persona ? `${w.persona.role.replace("_", " ")} (${w.persona.why})` : null },
    facts, angle: w.pain ? { pain: w.pain.pain, capability: w.pain.capability, proofPoint: w.sp.proofPoints[0]?.text ?? null } : null,
    whyNow: w.brief?.whyNow?.text ?? null, seller: { name: w.sp.name, summary: w.sp.summary, pitch: w.sp.messaging.default, cta: w.sp.messaging.cta },
    approved: w.approved, tone: w.sp.tone, bannedClaims: w.sp.bannedClaims, history, usedAngles: w.sent.map((m) => m.angle).filter((x): x is string => Boolean(x)),
    summary: summary ? `${summary.lastInteraction}. Concerns: ${summary.concerns.join("; ") || "none"}. Commitments: ${summary.commitments.join("; ") || "none"}.` : null, note, maxChars,
  });
  const usable = new Set(facts.map((f) => f.id));
  const checks = checkDraft(out, { kind, usableIds: usable, maxChars, banned: w.sp.bannedClaims, previous: w.sent.map((m) => m.sentText ?? m.body), conversationHasReply: w.received.length > 0, commitments: summary?.commitments ?? [] });
  const ok = checks.every((x) => x.pass);
  const version = (await db.linkedInMessage.count({ where: { journeyId, direction: "out", kind } })) + 1;
  return db.linkedInMessage.create({
    data: {
      journeyId, contactId: w.c.id, direction: "out", kind, status: ok ? "draft" : "blocked", body: out.body.trim(), why: out.why || null, angle: out.angle || null,
      factIds: [...new Set(out.claims.flatMap((c) => c.factIds).filter((id) => usable.has(id)))], checks: checks as unknown as Prisma.InputJsonValue, version, createdBy: by,
    },
  });
}

/** A person edited the draft: re-run the checks on their text (their claims are judged by the facts it already cites). */
export async function editDraft(messageId: string, body: string, by: string | null) {
  const m = await db.linkedInMessage.findUniqueOrThrow({ where: { id: messageId } });
  if (!["draft", "blocked", "approved"].includes(m.status)) throw new Error("Only drafts can be edited");
  const w = await loadWorkspace(m.journeyId);
  const kind = m.kind as MessageKind;
  const prior = (m.checks as unknown as { check: string; pass: boolean }[] | null) ?? [];
  const factsOk = prior.find((c) => c.check.startsWith("Every statement"))?.pass ?? true;
  const checks = checkDraft({ body, claims: [] }, { kind, usableIds: new Set(), maxChars: CHAR_LIMIT[kind], banned: w.sp.bannedClaims, previous: w.sent.map((x) => x.sentText ?? x.body), conversationHasReply: w.received.length > 0, commitments: ((w.j.summary as unknown as ConversationSummary | null)?.commitments ?? []) });
  checks[0] = { check: "Every statement about them cites a stored fact", pass: factsOk, detail: factsOk ? "Edited by a person: their wording is their responsibility; the cited facts are unchanged" : "The original draft had an unsupported statement: regenerate or remove it" };
  const ok = checks.every((x) => x.pass);
  return db.linkedInMessage.update({ where: { id: messageId }, data: { body, status: ok ? (m.status === "approved" ? "approved" : "draft") : "blocked", checks: checks as unknown as Prisma.InputJsonValue, approvedBy: ok ? m.approvedBy : null } });
}

export async function approveDraft(messageId: string, by: string | null) {
  const m = await db.linkedInMessage.findUniqueOrThrow({ where: { id: messageId } });
  if (m.status === "blocked") throw new Error("This draft failed a check: fix or regenerate it before approving");
  if (m.status !== "draft") throw new Error("Only a draft can be approved");
  return db.linkedInMessage.update({ where: { id: messageId }, data: { status: "approved", approvedBy: by } });
}

export async function discardDraft(messageId: string) {
  return db.linkedInMessage.update({ where: { id: messageId }, data: { status: "discarded" } });
}

const ACTIVITY: Record<MessageKind, (at: Date, detail: string) => Activity> = {
  connection_request: (at) => ({ type: "connection_sent", at }),
  initial: (at, detail) => ({ type: "message_sent", at, detail }),
  follow_up: (at) => ({ type: "follow_up_sent", at }),
  reply_positive: (at, detail) => ({ type: "message_sent", at, detail }),
  reply_objection: (at, detail) => ({ type: "message_sent", at, detail }),
  reply_info: (at, detail) => ({ type: "details_shared", at, detail }),
  referral: (at, detail) => ({ type: "message_sent", at, detail }),
  nurture: (at, detail) => ({ type: "message_sent", at, detail }),
  custom: (at, detail) => ({ type: "message_sent", at, detail }),
};

/** A person confirms they sent it on LinkedIn: the exact text and date are stored, the journey moves. Copying alone records nothing. */
export async function recordSent(messageId: string, text: string, at: Date, by: string | null) {
  const m = await db.linkedInMessage.findUniqueOrThrow({ where: { id: messageId } });
  if (m.status === "blocked") throw new Error("This draft failed a check and can't be recorded as sent");
  if (m.status === "sent") throw new Error("Already recorded as sent");
  if (!["draft", "approved"].includes(m.status)) throw new Error("Only a draft can be recorded as sent");
  if (at.getTime() > Date.now() + 5 * 60_000) throw new Error("The sent date can't be in the future");
  const sentText = text.trim() || m.body;
  const updated = await db.linkedInMessage.update({ where: { id: messageId }, data: { status: "sent", sentText, sentBy: by, approvedBy: m.approvedBy ?? by, occurredAt: at } });
  await recordActivities(m.journeyId, [ACTIVITY[m.kind as MessageKind](at, sentText.slice(0, 500))], "manual", by ? `by ${by}` : undefined);
  await refreshSummary(m.journeyId).catch(() => null);
  return updated;
}

/** A pasted reply: stored as received, read by the AI, checked by rules. The stage changes only when a person confirms. */
export async function recordReply(journeyId: string, text: string, at: Date, by: string | null) {
  const w = await loadWorkspace(journeyId);
  if (!text.trim()) throw new Error("Paste the reply");
  if (at.getTime() > Date.now() + 5 * 60_000) throw new Error("The reply date can't be in the future");
  const history = w.j.messages.filter((m) => m.status === "sent" || m.status === "received").map((m) => ({ direction: m.direction as "out" | "in", text: m.sentText ?? m.body }));
  let analysis: ReplyAnalysis;
  try {
    analysis = await getAdapters().llm.analyzeLinkedInReply(text, { company: w.a.name, title: w.c.titleNormalized ?? w.c.title, history });
  } catch {
    analysis = { type: "neutral", intent: "none", futureOpportunity: false, questions: [], mentions: [], commitments: [], stopRequested: false, continueOutreach: true, recommendedAction: "The AI couldn't read this reply: decide the next step yourself.", nextKind: null, suggestedStage: "replied_neutral", followUpOn: null, summary: text.slice(0, 120) };
  }
  analysis = guardAnalysis(analysis, text);
  return db.linkedInMessage.create({ data: { journeyId, contactId: w.c.id, direction: "in", kind: "reply", status: "received", body: text.trim(), sentText: text.trim(), analysis: analysis as unknown as Prisma.InputJsonValue, createdBy: by, occurredAt: at } });
}

/** A person confirms (or corrects) what the reply means: the journey moves and every rule that follows it runs. */
export async function confirmReply(messageId: string, stage: Stage, by: string | null) {
  const m = await db.linkedInMessage.findUniqueOrThrow({ where: { id: messageId }, include: { journey: { include: { contact: true } } } });
  const an = (m.analysis as unknown as ReplyAnalysis | null) ?? null;
  if (an && (an as ReplyAnalysis & { confirmed?: string }).confirmed) throw new Error("Already confirmed");
  await recordActivities(m.journeyId, [{ type: "reply", at: m.occurredAt ?? m.createdAt, text: m.body, meaning: stage }], "agent", by ? `confirmed by ${by}` : undefined);
  // A stop request stops outreach to this person on every channel.
  if (an?.stopRequested || stage === "not_interested" && an?.type === "stop_request") {
    const c = m.journey.contact;
    await db.contact.update({ where: { id: c.id }, data: { state: "do_not_contact" } });
    if (c.email) await db.suppression.upsert({ where: { value: c.email.toLowerCase() }, create: { value: c.email.toLowerCase(), reason: "manual" }, update: {} });
    await db.enrollment.updateMany({ where: { contactId: c.id, status: { in: ["active", "paused"] } }, data: { status: "stopped", pausedReason: "linkedin: asked not to be contacted" } });
  }
  // "Talk to me later": a dated task so the reconnect isn't forgotten.
  if (an?.followUpOn) {
    const c = m.journey.contact;
    const acct = await db.account.findUnique({ where: { id: c.accountId }, select: { ownerId: true } });
    await db.task.create({ data: { title: `Reconnect with ${c.fullName} on LinkedIn`, body: an.recommendedAction, accountId: c.accountId, contactId: c.id, assigneeId: acct?.ownerId ?? null, origin: "reply", dueAt: new Date(`${an.followUpOn}T09:00:00Z`) } });
  }
  await db.linkedInMessage.update({ where: { id: messageId }, data: { analysis: { ...(an ?? {}), confirmed: STAGE_INFO[stage].label, confirmedBy: by } as unknown as Prisma.InputJsonValue } });
  await db.journey.update({ where: { id: m.journeyId }, data: { upToDateAt: new Date(), summaryEditedBy: null } });
  await refreshSummary(m.journeyId).catch(() => null);
}

/** The person confirms there's no reply they haven't recorded (needed before a follow-up). */
export async function confirmUpToDate(journeyId: string) {
  return db.journey.update({ where: { id: journeyId }, data: { upToDateAt: new Date() } });
}

/** Re-summarise from the recorded messages (a person's correction is kept until the next reply). */
export async function refreshSummary(journeyId: string, force = false) {
  const j = await db.journey.findUniqueOrThrow({ where: { id: journeyId }, include: { contact: { include: { account: true } }, messages: { where: { status: { in: ["sent", "received"] } }, orderBy: { createdAt: "asc" } } } });
  if (j.summaryEditedBy && !force) return j.summary;
  if (!j.messages.length) return null;
  const history = j.messages.map((m) => ({ direction: m.direction as "out" | "in", kind: m.kind, text: m.sentText ?? m.body, at: day(m.occurredAt ?? m.createdAt) }));
  const s = await getAdapters().llm.summarizeConversation(history, { company: j.contact.account.name, contact: j.contact.fullName, stage: STAGE_INFO[j.stage as Stage].label });
  await db.journey.update({ where: { id: journeyId }, data: { summary: s as unknown as Prisma.InputJsonValue, summaryEditedBy: null } });
  return s;
}

export async function correctSummary(journeyId: string, s: ConversationSummary, by: string) {
  return db.journey.update({ where: { id: journeyId }, data: { summary: s as unknown as Prisma.InputJsonValue, summaryEditedBy: by } });
}
