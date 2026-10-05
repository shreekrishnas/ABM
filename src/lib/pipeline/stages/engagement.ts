// Stages 12–13: Sequence/Send/Measure and Sales Handoff/Recycle, plus the
// continuous signal engine (account-level engagement, buying stage, MQA).

import type { Account, Prisma, ReplyClass, SignalType } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { bounceBreaker, preSendGate, REPLY_ROUTES } from "../gates";
import { accountEngagement, stageFromEngagement } from "../scoring";
import { addToWatchlist, charge, isSuppressed, logEvent, newContext, openReview, type RunContext } from "../context";
import { setContactField } from "../fields";
import { draftForContact, usableFacts } from "./outreach";

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// ───────────────────────── Sending ─────────────────────────

export async function breakerState(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [sent, hard] = await Promise.all([
    db.message.count({ where: { sentAt: { gte: since }, status: { in: ["delivered", "bounced"] } } }),
    db.message.count({ where: { sentAt: { gte: since }, bounceType: "hard" } }),
  ]);
  return { ...bounceBreaker(sent, hard), sent, hard };
}

async function pickMailbox(now: Date) {
  const boxes = await db.mailbox.findMany({ where: { active: true, warmedUp: true }, orderBy: { createdAt: "asc" } });
  const day = startOfDay(now);
  let best: { address: string; cap: number; sent: number } | null = null;
  for (const b of boxes) {
    const sent = await db.message.count({ where: { mailbox: b.address, sentAt: { gte: day } } });
    if (sent < b.dailyCap && (!best || sent < best.sent)) best = { address: b.address, cap: b.dailyCap, sent };
  }
  return best;
}

/** Send every approved, unsent email draft. Idempotent: Message.draftId is unique. */
export async function sendApproved(ctx: RunContext = newContext()) {
  const S = 12;
  const breaker = await breakerState(ctx.now);
  const drafts = await db.draft.findMany({ where: { status: "approved", message: null }, include: { contact: { include: { account: true } } }, orderBy: { createdAt: "asc" } });
  const result = { sent: 0, held: 0, reasons: [] as string[] };
  if (!breaker.pass && drafts.length) {
    await openReview({ type: "bounce_breaker", stage: S, reason: breaker.reason });
  }
  for (const d of drafts) {
    const c = d.contact;
    const box = await pickMailbox(ctx.now);
    const globalSent = await db.message.count({ where: { sentAt: { gte: startOfDay(ctx.now) } } });
    const enrollment = await db.enrollment.findFirst({ where: { contactId: c.id, status: "active" } });
    const gate = preSendGate({
      suppressed: (await isSuppressed(c.email)) || c.state === "suppressed",
      lawfulBasis: c.lawfulBasis,
      mailboxSentToday: box?.sent ?? Infinity,
      mailboxCap: box?.cap ?? 0,
      globalSentToday: globalSent,
      contactPaused: !enrollment || ["paused", "handed_off", "replied", "do_not_contact"].includes(c.state),
      breakerTripped: !breaker.pass,
    });
    await logEvent(ctx, { accountId: c.accountId, contactId: c.id, stage: S, step: "sequence_send.pre_send_checks", outcome: gate.pass ? "pass" : "block", reason: gate.reason });
    if (!gate.pass || !box || !c.email) {
      result.held++;
      result.reasons.push(`${c.fullName}: ${gate.reason}`);
      continue;
    }
    // Claim the send first; a concurrent run hits the unique constraint and skips.
    let msg;
    try {
      msg = await db.message.create({ data: { draftId: d.id, contactId: c.id, mailbox: box.address, status: "queued" } });
    } catch {
      await logEvent(ctx, { accountId: c.accountId, contactId: c.id, stage: S, step: "sequence_send.send_once", outcome: "info", reason: "Duplicate send skipped" });
      continue;
    }
    try {
      const r = await ctx.adapters.email.send({ from: box.address, to: c.email, subject: d.subject, body: d.body, idempotencyKey: d.id });
      await db.$transaction([
        db.message.update({ where: { id: msg.id }, data: { status: "delivered", providerId: r.providerId, sentAt: ctx.now } }),
        db.draft.update({ where: { id: d.id }, data: { status: "sent" } }),
        db.contact.update({ where: { id: c.id }, data: { state: "in_sequence" } }),
      ]);
      await advanceEnrollment(c.id, d.stepOrder, ctx.now);
      await logEvent(ctx, { accountId: c.accountId, contactId: c.id, stage: S, step: "sequence_send.send_once", outcome: "pass", reason: `Step ${d.stepOrder} delivered via ${box.address}` });
      await bumpStage(c.account, "AWARE");
      result.sent++;
    } catch (e) {
      await db.message.update({ where: { id: msg.id }, data: { status: "failed" } });
      await logEvent(ctx, { accountId: c.accountId, contactId: c.id, stage: S, step: "sequence_send.send_once", outcome: "error", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

async function bumpStage(account: Account, atLeast: "AWARE") {
  if (account.stage === "UNAWARE") await db.account.update({ where: { id: account.id }, data: { stage: atLeast } });
}

async function advanceEnrollment(contactId: string, sentStep: number, now: Date) {
  const e = await db.enrollment.findFirst({ where: { contactId, status: "active" }, include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } } } });
  if (!e) return;
  const current = e.sequence.steps.find((s) => s.order === sentStep);
  const next = e.sequence.steps.find((s) => s.order > sentStep);
  if (!next) {
    await db.enrollment.update({ where: { id: e.id }, data: { status: "completed", currentStep: sentStep, nextDueAt: null } });
    return;
  }
  const gap = next.dayOffset - (current?.dayOffset ?? 0);
  await db.enrollment.update({ where: { id: e.id }, data: { currentStep: next.order, nextDueAt: new Date(now.getTime() + gap * 86_400_000) } });
}

/** Advance due sequence steps: email steps get a draft, other channels become rep tasks. */
export async function tickSequences(ctx: RunContext = newContext()) {
  const due = await db.enrollment.findMany({
    where: { status: "active", nextDueAt: { lte: ctx.now } },
    include: { contact: { include: { account: true } }, sequence: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  let drafts = 0;
  let tasks = 0;
  for (const e of due) {
    const step = e.sequence.steps.find((s) => s.order === e.currentStep);
    if (!step) continue;
    if (["paused", "replied", "handed_off", "suppressed"].includes(e.contact.state)) continue;
    if (step.channel === "email") {
      const d = await draftForContact(e.contact.account, e.contact, step.order, step.instruction, ctx);
      if (d) drafts++;
      await db.enrollment.update({ where: { id: e.id }, data: { nextDueAt: null } });
    } else {
      await db.task.create({
        data: {
          title: `${step.channel === "linkedin" ? "LinkedIn touch" : step.channel === "call" ? "Call" : "Task"}: ${e.contact.fullName} (${e.contact.account.name})`,
          body: step.instruction, channel: step.channel, dueAt: ctx.now, accountId: e.contact.accountId, contactId: e.contactId,
          assigneeId: e.contact.account.ownerId, origin: "sequence",
        },
      });
      tasks++;
      await advanceEnrollment(e.contactId, step.order, ctx.now);
    }
  }
  return { drafts, tasks };
}

// ───────────────────────── Signals & scoring ─────────────────────────

export async function recomputeAccount(accountId: string, ctx: RunContext = newContext()) {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const since = new Date(ctx.now.getTime() - 120 * 86_400_000);
  const signals = await db.signal.findMany({ where: { accountId, occurredAt: { gte: since } } });
  const score = accountEngagement(signals, ctx.now);
  const stage = stageFromEngagement(account.stage, score);
  const updated = await db.account.update({ where: { id: accountId }, data: { engagementScore: score, stage } });
  if (stage !== account.stage) {
    await logEvent(ctx, { accountId, stage: 12, step: "sequence_send.engagement_score", outcome: "info", reason: `Buying stage ${account.stage} → ${stage} (score ${score})` });
  }
  if (stage === "MQA" && account.stage !== "MQA") {
    const open = await db.handoff.findFirst({ where: { accountId, acknowledgedAt: null } });
    if (!open) await s13Handoff(updated, "mqa_threshold", ctx);
  }
  return updated;
}

/**
 * Record any engagement or intent signal. Engagement from people we never
 * contacted is kept (it is account-level evidence) but marked unattributed so it
 * cannot trigger a person-level handoff on its own.
 */
export async function recordSignal(input: { accountId: string; contactId?: string | null; type: SignalType; source: string; detail?: string; occurredAt?: Date }, ctx: RunContext = newContext()) {
  let attributed = false;
  if (input.contactId) attributed = (await db.message.count({ where: { contactId: input.contactId, status: "delivered" } })) > 0;
  const points = CONFIG.engagement.points[input.type];
  await db.signal.create({
    data: {
      accountId: input.accountId, contactId: input.contactId ?? null, type: input.type, points, attributed,
      anonymous: !input.contactId, source: input.source, detail: input.detail, occurredAt: input.occurredAt ?? ctx.now,
    },
  });
  await logEvent(ctx, {
    accountId: input.accountId, contactId: input.contactId, stage: 12, step: "sequence_send.attribution_check", outcome: "info",
    reason: `${input.type} +${points}${attributed ? "" : input.contactId ? " (uncontacted — account-level only)" : " (anonymous — account-level only)"}`,
  });
  return recomputeAccount(input.accountId, ctx);
}

// ───────────────────────── Replies & bounces ─────────────────────────

export async function recordReply(contactId: string, body: string, ctx: RunContext = newContext()) {
  const S = 12;
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId }, include: { account: true } });
  const lastMsg = await db.message.findFirst({ where: { contactId, status: "delivered" }, orderBy: { sentAt: "desc" } });
  await charge(contact.accountId, contact.account.tier, "llm", CONFIG.costsUsd.llmCheap, "Classify reply", S).catch(() => undefined);
  const cls = (await ctx.adapters.llm.classifyReply(body)) as ReplyClass;
  await db.reply.create({ data: { contactId, messageId: lastMsg?.id ?? null, body, class: cls, route: REPLY_ROUTES[cls] } });
  await logEvent(ctx, { accountId: contact.accountId, contactId, stage: S, step: "sequence_send.classify_reply", outcome: "info", reason: `${cls}: ${REPLY_ROUTES[cls]}` });

  const pauseAll = (reason: string) => db.enrollment.updateMany({ where: { contactId, status: "active" }, data: { status: "paused", pausedReason: reason } });

  switch (cls) {
    case "positive":
      await pauseAll("positive reply");
      await db.contact.update({ where: { id: contactId }, data: { state: "replied" } });
      await recordSignal({ accountId: contact.accountId, contactId, type: "email_reply", source: "email_provider", detail: "positive" }, ctx);
      if (!(await db.handoff.findFirst({ where: { accountId: contact.accountId, acknowledgedAt: null } }))) {
        await s13Handoff(await db.account.findUniqueOrThrow({ where: { id: contact.accountId } }), "positive_reply", ctx);
      }
      break;
    case "not_now":
      await pauseAll("not now");
      await db.contact.update({ where: { id: contactId }, data: { state: "paused" } });
      await addToWatchlist(contact.accountId, `${contact.fullName} said not now`, CONFIG.watch.notNowDays, ctx.now);
      break;
    case "objection":
      await db.note.create({ data: { accountId: contact.accountId, contactId, body: `Objection from ${contact.fullName}: ${body.slice(0, 500)}` } });
      await recordSignal({ accountId: contact.accountId, contactId, type: "email_reply", source: "email_provider", detail: "objection" }, ctx);
      break;
    case "wrong_person":
      await pauseAll("wrong person");
      await db.contact.update({ where: { id: contactId }, data: { state: "paused", buyingRole: "unknown" } });
      await setContactField(contactId, "title", { status: "stale" });
      await db.task.create({ data: { title: `Ask ${contact.fullName} for a referral`, body: `They replied: "${body.slice(0, 200)}". Ask who owns this and re-map the buying group.`, accountId: contact.accountId, contactId, assigneeId: contact.account.ownerId, origin: "reply", dueAt: ctx.now } });
      break;
    case "unsubscribe":
      await db.enrollment.updateMany({ where: { contactId }, data: { status: "stopped", pausedReason: "unsubscribed" } });
      await db.contact.update({ where: { id: contactId }, data: { state: "suppressed" } });
      if (contact.email) await db.suppression.upsert({ where: { value: contact.email.toLowerCase() }, create: { value: contact.email.toLowerCase(), reason: "unsubscribe" }, update: {} });
      break;
    case "out_of_office": {
      const e = await db.enrollment.findFirst({ where: { contactId, status: "active" } });
      if (e?.nextDueAt) await db.enrollment.update({ where: { id: e.id }, data: { nextDueAt: new Date(e.nextDueAt.getTime() + 7 * 86_400_000) } });
      break;
    }
    case "needs_human":
      await pauseAll("needs human read");
      await openReview({ type: "needs_human_reply", stage: S, accountId: contact.accountId, contactId, reason: `Unclear reply from ${contact.fullName}`, payload: { body } });
      break;
  }
  return cls;
}

export async function recordBounce(messageId: string, type: "hard" | "soft", ctx: RunContext = newContext()) {
  const m = await db.message.update({ where: { id: messageId }, data: { status: "bounced", bounceType: type, bouncedAt: ctx.now }, include: { contact: true } });
  if (type === "hard") {
    await setContactField(m.contactId, "email", { status: "invalid", source: "hard_bounce" });
    if (m.contact.email) await db.suppression.upsert({ where: { value: m.contact.email.toLowerCase() }, create: { value: m.contact.email.toLowerCase(), reason: "hard_bounce" }, update: {} });
    await db.contact.update({ where: { id: m.contactId }, data: { state: "suppressed" } });
    await db.enrollment.updateMany({ where: { contactId: m.contactId }, data: { status: "stopped", pausedReason: "hard bounce" } });
  }
  await logEvent(ctx, { accountId: m.contact.accountId, contactId: m.contactId, stage: 12, step: "sequence_send.bounce", outcome: "block", reason: `${type} bounce` });
  const breaker = await breakerState(ctx.now);
  if (!breaker.pass) await openReview({ type: "bounce_breaker", stage: 12, reason: breaker.reason });
  return breaker;
}

// ───────────────────────── Stage 13 ─────────────────────────

export async function s13Handoff(account: Account, trigger: "positive_reply" | "mqa_threshold" | "manual", ctx: RunContext = newContext()) {
  const S = 13;
  const facts = await usableFacts(account.id, ctx.now);
  const twin = await db.twinVersion.findFirst({ where: { accountId: account.id }, orderBy: { version: "desc" } });
  const unknowns = ((twin?.snapshot as { unknowns?: string[] } | null)?.unknowns ?? []) as string[];
  const engagedRows = await db.signal.findMany({ where: { accountId: account.id, contactId: { not: null } }, include: { contact: true }, orderBy: { occurredAt: "desc" }, take: 50 });
  const engagedMap = new Map<string, { name: string; title: string | null; signals: string[] }>();
  for (const s of engagedRows) {
    if (!s.contact) continue;
    const e = engagedMap.get(s.contact.id) ?? { name: s.contact.fullName, title: s.contact.titleNormalized, signals: [] };
    if (!e.signals.includes(s.type)) e.signals.push(s.type);
    engagedMap.set(s.contact.id, e);
  }
  const anonymous = await db.signal.count({ where: { accountId: account.id, anonymous: true } });

  await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, "Write briefing", S).catch(() => undefined);
  const brief = await ctx.adapters.llm.briefing({
    company: account.name,
    facts: facts.map((f) => ({ id: f.id, claim: f.claim })),
    unknowns,
    engaged: [...engagedMap.values()],
    trigger,
  });
  // Guardrail: every statement must cite a usable fact.
  const ids = new Set(facts.map((f) => f.id));
  const blocked = brief.facts.some((f) => !ids.has(f.factId));
  await logEvent(ctx, { accountId: account.id, stage: S, step: "handoff.briefing_guardrail", outcome: blocked ? "block" : "pass", reason: blocked ? "Briefing cites a non-usable fact" : "Every statement cites a usable fact" });

  const owner = account.ownerId ? await db.user.findUnique({ where: { id: account.ownerId } }) : null;
  const handoff = await db.handoff.create({
    data: {
      accountId: account.id, ownerId: account.ownerId, trigger,
      briefing: { ...brief, anonymousSignals: anonymous } as unknown as Prisma.InputJsonValue,
      blocked,
      alertedAt: blocked ? null : ctx.now,
      ackDueAt: blocked ? null : new Date(ctx.now.getTime() + CONFIG.handoff.ackSlaHours * 3_600_000),
    },
  });
  if (blocked) {
    await openReview({ type: "briefing_blocked", stage: S, accountId: account.id, reason: "Briefing failed the fact guardrail" });
    return handoff;
  }
  await ctx.adapters.notifier.alert(owner?.email ?? "unassigned@sales", `${account.name} is ready for sales`, brief.whyNow);
  await logEvent(ctx, { accountId: account.id, stage: S, step: "handoff.alert_owner", outcome: "pass", reason: `Alerted ${owner?.name ?? "unassigned queue"} (${trigger.replace("_", " ")})` });

  // Automation stops for the whole account; the rep owns it now.
  const contacts = await db.contact.findMany({ where: { accountId: account.id }, select: { id: true } });
  await db.enrollment.updateMany({ where: { contactId: { in: contacts.map((c) => c.id) }, status: "active" }, data: { status: "paused", pausedReason: "handed off to sales" } });
  await db.contact.updateMany({ where: { accountId: account.id, state: { in: ["ready", "in_sequence", "replied", "selected"] } }, data: { state: "handed_off" } });
  await db.draft.updateMany({ where: { contactId: { in: contacts.map((c) => c.id) }, status: { in: ["pending_review", "approved"] } }, data: { status: "rejected", reviewerNote: "Withdrawn — account handed off to sales" } });
  await db.reviewItem.updateMany({ where: { accountId: account.id, type: "draft_approval", status: "open" }, data: { status: "dismissed", resolution: "Account handed off", resolvedAt: ctx.now } });
  await db.account.update({ where: { id: account.id }, data: { stage: account.stage === "OPPORTUNITY" ? "OPPORTUNITY" : "MQA", pipelineStage: 13, pipelineStatus: "done" } });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "handoff.pause_sequences", outcome: "pass", reason: "All automated outreach paused" });
  return handoff;
}

export async function acknowledgeHandoff(handoffId: string) {
  return db.handoff.update({ where: { id: handoffId }, data: { acknowledgedAt: new Date() } });
}

/** Escalate handoffs not acknowledged within the SLA. */
export async function escalateOverdue(ctx: RunContext = newContext()) {
  const overdue = await db.handoff.findMany({ where: { acknowledgedAt: null, escalatedAt: null, blocked: false, ackDueAt: { lt: ctx.now } }, include: { account: true } });
  for (const h of overdue) {
    await db.handoff.update({ where: { id: h.id }, data: { escalatedAt: ctx.now } });
    await ctx.adapters.notifier.alert("sales-managers@company", `Unacknowledged handoff: ${h.account.name}`, `Not acknowledged within ${CONFIG.handoff.ackSlaHours}h`);
    await logEvent(ctx, { accountId: h.accountId, stage: 13, step: "handoff.ack_sla", outcome: "block", reason: `Not acknowledged in ${CONFIG.handoff.ackSlaHours}h — escalated to manager` });
  }
  return overdue.length;
}

/** Closed-won → customer. Closed-lost → watchlist then recycle. */
export async function recordOutcome(opportunityId: string, outcome: "won" | "lost", lostReason?: string, ctx: RunContext = newContext()) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  const facts = await usableFacts(opp.accountId, ctx.now);
  await db.opportunity.update({
    where: { id: opportunityId },
    data: { stage: outcome, closedAt: ctx.now, lostReason: outcome === "lost" ? lostReason ?? null : null, factTypesAtClose: [...new Set(facts.map((f) => f.key))] },
  });
  if (outcome === "won") {
    await db.account.update({ where: { id: opp.accountId }, data: { relationship: "customer", stage: "CUSTOMER" } });
  } else {
    await db.account.update({ where: { id: opp.accountId }, data: { stage: "RECYCLED" } });
    await addToWatchlist(opp.accountId, `Closed-lost${lostReason ? `: ${lostReason}` : ""}`, CONFIG.watch.lostDealDays, ctx.now);
  }
  const closed = await db.opportunity.count({ where: { stage: { in: ["won", "lost"] } } });
  await logEvent(ctx, {
    accountId: opp.accountId, stage: 13, step: "handoff.record_outcome", outcome: "info",
    reason: `${outcome}${lostReason ? ` (${lostReason})` : ""}${lostReason || outcome === "won" ? "" : " — reason missing (flagged)"}; ${closed}/${CONFIG.handoff.retuneMinClosedDeals} closed deals before weights may retune`,
  });
}
