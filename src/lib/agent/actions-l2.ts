// Level 2: Vega reacts to an event at once, then tells the team. These add to what the
// pipeline already does on a reply or bounce (pause, suppress, hand off); nothing here sends.
import { z } from "zod";
import { db } from "@/lib/db";
import type { AgentTool } from "./types";

const define = <S extends z.ZodTypeAny>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;
const Person = { contactId: z.string().min(5).max(40), accountId: z.string().min(5).max(40) };
const DAY = 86_400_000;

async function ownerTask(data: { title: string; body: string; accountId: string; contactId?: string | null; dueInDays: number; origin: string }) {
  const a = await db.account.findUnique({ where: { id: data.accountId }, select: { ownerId: true } });
  const t = await db.task.create({ data: { title: data.title, body: data.body, accountId: data.accountId, contactId: data.contactId ?? null, assigneeId: a?.ownerId ?? null, dueAt: new Date(Date.now() + data.dueInDays * DAY), origin: data.origin }, select: { id: true } });
  return t.id;
}

const cancelTask = async (undo: unknown) => {
  const r = await db.task.updateMany({ where: { id: (undo as { taskId: string }).taskId, status: "todo" }, data: { status: "cancelled" } });
  if (!r.count) throw new Error("The task was already picked up, so it was left as it is");
};

/** An opt-out reaches every channel. Never reversible by Vega: only a person with a documented reason may lift an opt-out, outside Vega. */
export const optOutEverywhere = define({
  name: "opt_out_everywhere",
  description: "After an unsubscribe, complaint or hard bounce: stop this person's LinkedIn journeys and open outreach tasks too (email is already stopped and suppressed).",
  input: z.object({ ...Person, why: z.string().max(80) }),
  level: 2,
  minRole: "viewer",
  reversible: false,
  target: ({ contactId, accountId }) => ({ contactId, accountId }),
  run: async ({ contactId, why }) => {
    const journeys = await db.journey.findMany({ where: { contactId, stage: { notIn: ["not_interested", "disqualified", "closed_won", "closed_lost"] } }, select: { id: true, stage: true } });
    for (const j of journeys) {
      await db.journey.update({ where: { id: j.id }, data: { stage: "not_interested", stageReason: `Opted out (${why}) — stopped by Vega` } });
      await db.journeyEvent.create({ data: { journeyId: j.id, type: "stage_set", fromStage: j.stage, toStage: "not_interested", source: "system", detail: `Opted out: ${why}`, occurredAt: new Date() } });
    }
    const tasks = await db.task.updateMany({ where: { contactId, status: { in: ["todo", "in_progress"] }, origin: { in: ["sequence", "jarvis"] } }, data: { status: "cancelled" } });
    await db.contact.update({ where: { id: contactId }, data: { state: "suppressed" } });
    return { journeysStopped: journeys.length, tasksCancelled: tasks.count };
  },
});

export const hotReplyHandoff = define({
  name: "hot_reply_handoff",
  description: "After a positive reply: make sure the account owner has a task to answer within a day, with the reply quoted (the hand-off itself is created by the pipeline).",
  input: z.object({ ...Person, excerpt: z.string().max(400).optional() }),
  level: 2,
  minRole: "viewer",
  reversible: true,
  target: ({ contactId, accountId }) => ({ contactId, accountId }),
  run: async ({ contactId, accountId, excerpt }) => {
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { fullName: true, account: { select: { name: true } } } });
    const taskId = await ownerTask({ title: `Reply to ${c?.fullName ?? "the prospect"} (${c?.account.name ?? ""}) within 24h`, body: `They replied with interest${excerpt ? `: "${excerpt}"` : "."} A hand-off has been opened. Added by Vega.`, accountId, contactId, dueInDays: 1, origin: "jarvis" });
    const handoff = await db.handoff.findFirst({ where: { accountId, acknowledgedAt: null }, select: { id: true } });
    return { taskId, handoffOpen: Boolean(handoff), __undo: { taskId } };
  },
  undo: cancelTask,
});

export const questionTask = define({
  name: "question_task",
  description: "After a reply that needs a person (an objection or an unclear answer): a task for the owner with the reply quoted. Follow-ups are already paused.",
  input: z.object({ ...Person, excerpt: z.string().max(400).optional(), kind: z.string().max(30) }),
  level: 2,
  minRole: "viewer",
  reversible: true,
  target: ({ contactId, accountId }) => ({ contactId, accountId }),
  run: async ({ contactId, accountId, excerpt, kind }) => {
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { fullName: true } });
    const taskId = await ownerTask({ title: `Answer ${c?.fullName ?? "the prospect"}'s ${kind === "objection" ? "objection" : "reply"}`, body: `${excerpt ? `They wrote: "${excerpt}". ` : ""}Follow-ups are paused until someone answers. The full reply is in Approvals. Added by Vega.`, accountId, contactId, dueInDays: 1, origin: "jarvis" });
    return { taskId, __undo: { taskId } };
  },
  undo: cancelTask,
});

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A return date written in an out-of-office reply ("back on 3 December", "until 12/05", "returning Dec 3"), or null. Always in the future, within 90 days. */
export function returnDate(text: string, now = new Date()): Date | null {
  const t = text.toLowerCase();
  const mk = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
  const fix = (d: Date) => { if (d.getTime() < now.getTime() - DAY) d = mk(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()); return d.getTime() - now.getTime() <= 90 * DAY ? d : null; };
  let m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
  if (m) return fix(mk(now.getUTCFullYear(), MONTHS.indexOf(m[2]), Number(m[1])));
  m = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (m) return fix(mk(now.getUTCFullYear(), MONTHS.indexOf(m[1]), Number(m[2])));
  m = t.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getUTCFullYear();
    const d = Number(m[1]), mo = Number(m[2]) - 1;
    if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) return fix(mk(y, mo, d));
  }
  return null;
}

export const oooReschedule = define({
  name: "ooo_reschedule",
  description: "After an out-of-office reply: move this person's next step to the day after they return (7 days if no date is given).",
  input: z.object({ ...Person, excerpt: z.string().max(400).optional() }),
  level: 2,
  minRole: "viewer",
  reversible: true,
  target: ({ contactId, accountId }) => ({ contactId, accountId }),
  run: async ({ contactId, excerpt }) => {
    const e = await db.enrollment.findFirst({ where: { contactId, status: "active" }, orderBy: { nextDueAt: "asc" }, select: { id: true, nextDueAt: true } });
    if (!e) return { moved: false, note: "No active sequence step" };
    const back = excerpt ? returnDate(excerpt) : null;
    const next = back ? new Date(back.getTime() + DAY) : new Date(Date.now() + 7 * DAY);
    await db.enrollment.update({ where: { id: e.id }, data: { nextDueAt: next } });
    return { moved: true, returnDate: back?.toISOString().slice(0, 10) ?? null, nextStep: next.toISOString().slice(0, 10), __undo: { enrollmentId: e.id, nextDueAt: e.nextDueAt } };
  },
  undo: async (undo) => {
    const u = undo as { enrollmentId: string; nextDueAt: string | null };
    await db.enrollment.update({ where: { id: u.enrollmentId }, data: { nextDueAt: u.nextDueAt ? new Date(u.nextDueAt) : null } });
  },
});

export const findReplacement = define({
  name: "find_replacement",
  description: "After a hard bounce or a 'wrong person' reply: look for someone else in the same role at the company (runs the buying-group step again). Costs a data lookup.",
  input: z.object({ ...Person }),
  level: 2,
  minRole: "viewer",
  reversible: true,
  estimateCostUsd: () => 0.2,
  target: ({ contactId, accountId }) => ({ contactId, accountId }),
  run: async ({ accountId }) => {
    const a = await db.account.findUnique({ where: { id: accountId }, select: { pipelineStatus: true, queuedFromStage: true, stage: true } });
    if (!a) throw new Error("Company not found");
    if (a.stage === "DISQUALIFIED") return { queued: false, note: "Company is ruled out" };
    if (a.pipelineStatus === "running" || a.pipelineStatus === "queued") return { queued: false, note: `Already ${a.pipelineStatus}` };
    await db.account.update({ where: { id: accountId }, data: { pipelineStatus: "queued", queuedFromStage: 8, nextRetryAt: null, retryCount: 0, lastError: null } });
    return { queued: true, __undo: { accountId, pipelineStatus: a.pipelineStatus, queuedFromStage: a.queuedFromStage } };
  },
  undo: async (undo) => {
    const u = undo as { accountId: string; pipelineStatus: string; queuedFromStage: number | null };
    const r = await db.account.updateMany({ where: { id: u.accountId, pipelineStatus: "queued" }, data: { pipelineStatus: u.pipelineStatus, queuedFromStage: u.queuedFromStage } });
    if (!r.count) throw new Error("It has already started, so it can't be undone");
  },
});

export const meetingPrep = define({
  name: "meeting_prep",
  description: "When a call or demo is booked: a prep task for the owner with what to read first.",
  input: z.object({ ...Person, stage: z.string().max(30) }),
  level: 2,
  minRole: "viewer",
  reversible: true,
  target: ({ contactId, accountId }) => ({ contactId, accountId }),
  run: async ({ contactId, accountId, stage }) => {
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { fullName: true, account: { select: { name: true } } } });
    const taskId = await ownerTask({ title: `Prepare for the ${stage === "demo_scheduled" ? "demo" : "call"} with ${c?.fullName ?? "the prospect"} (${c?.account.name ?? ""})`, body: `Before the meeting: read the company's "What we know" summary and buying group, and the last messages. Vega can brief you: open /vega?a=${accountId}. Added by Vega.`, accountId, contactId, dueInDays: 0, origin: "jarvis" });
    return { taskId, __undo: { taskId } };
  },
  undo: cancelTask,
});

export const budgetBrake = define({
  name: "budget_brake",
  description: "When monthly spend passes 90% of the client's budget: pause Vega's own paid work for the client. People can still run things by hand.",
  input: z.object({ share: z.number() }),
  level: 2,
  minRole: "viewer",
  reversible: true,
  run: async (_input, ctx) => {
    const s = await db.agentSetting.findUnique({ where: { sellerId: ctx.sellerId } });
    if (!s || s.paused) return { paused: false, note: s ? "Already paused" : "Vega isn't set up for this client" };
    await db.agentSetting.update({ where: { sellerId: ctx.sellerId }, data: { paused: true } });
    return { paused: true, __undo: { sellerId: ctx.sellerId } };
  },
  undo: async (undo) => { await db.agentSetting.update({ where: { sellerId: (undo as { sellerId: string }).sellerId }, data: { paused: false } }); },
});

export const LEVEL2 = [optOutEverywhere, hotReplyHandoff, questionTask, oooReschedule, findReplacement, meetingPrep, budgetBrake];
