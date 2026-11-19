// Level 1: work JARVIS does on its own. Each action changes only data inside the app, is
// logged with its reason, and records what Undo needs. Nothing here contacts anyone.
import { z } from "zod";
import { db } from "@/lib/db";
import type { AgentTool } from "./types";

const define = <S extends z.ZodTypeAny>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;
const AccountInput = z.object({ accountId: z.string().min(5).max(40) });

/** Queue a company back into the pipeline from a stage, if nothing is running for it. Returns the previous state for Undo. */
async function queueFrom(accountId: string, stage: number) {
  const a = await db.account.findUnique({ where: { id: accountId }, select: { pipelineStatus: true, queuedFromStage: true } });
  if (!a) throw new Error("Company not found");
  if (a.pipelineStatus === "running" || a.pipelineStatus === "queued") return { queued: false, note: `Already ${a.pipelineStatus}` };
  await db.account.update({ where: { id: accountId }, data: { pipelineStatus: "queued", queuedFromStage: stage, nextRetryAt: null, retryCount: 0, lastError: null } });
  return { queued: true, __undo: { accountId, pipelineStatus: a.pipelineStatus, queuedFromStage: a.queuedFromStage } };
}

/** Undo for a queued run: only possible while it is still waiting in the queue. */
async function unqueue(undo: unknown) {
  const u = undo as { accountId: string; pipelineStatus: string; queuedFromStage: number | null } | null;
  if (!u) throw new Error("Nothing to undo");
  const r = await db.account.updateMany({ where: { id: u.accountId, pipelineStatus: "queued" }, data: { pipelineStatus: u.pipelineStatus, queuedFromStage: u.queuedFromStage } });
  if (!r.count) throw new Error("It has already started, so it can't be undone");
}

export const refreshResearch = define({
  name: "refresh_research",
  description: "Re-run research for a priority company whose newest research is past its freshness window. Queues it from the research step; costs search and AI credits.",
  input: AccountInput,
  level: 1,
  minRole: "manager",
  reversible: true,
  estimateCostUsd: () => 0.3,
  target: ({ accountId }) => ({ accountId }),
  run: ({ accountId }) => queueFrom(accountId, 5),
  undo: (undo) => unqueue(undo),
});

export const prepareDrafts = define({
  name: "prepare_drafts",
  description: "Write first-email drafts for a company whose people are ready but have no draft yet. Drafts go to Approvals; nothing is sent.",
  input: AccountInput,
  level: 1,
  minRole: "manager",
  reversible: true,
  estimateCostUsd: () => 0.1,
  target: ({ accountId }) => ({ accountId }),
  run: ({ accountId }) => queueFrom(accountId, 11),
  undo: (undo) => unqueue(undo),
});

export const rescore = define({
  name: "rescore",
  description: "Re-read a company's intent and priority after new signals arrived. Free; keeps the previous reading for Undo.",
  input: AccountInput,
  level: 1,
  minRole: "manager",
  reversible: true,
  target: ({ accountId }) => ({ accountId }),
  run: async ({ accountId }) => {
    const before = await db.account.findUnique({ where: { id: accountId }, select: { intentReading: true, priorityScore: true, priorityParts: true } });
    if (!before) throw new Error("Company not found");
    const { readIntent } = await import("@/lib/brain/intent");
    const reading = await readIntent(accountId);
    const after = await db.account.findUnique({ where: { id: accountId }, select: { priorityScore: true } });
    return { before: before.priorityScore, after: after?.priorityScore ?? null, level: reading.level, intent: reading.score, __undo: { accountId, ...before } };
  },
  undo: async (undo) => {
    const u = undo as { accountId: string; intentReading: object | null; priorityScore: number | null; priorityParts: object | null };
    await db.account.update({ where: { id: u.accountId }, data: { intentReading: u.intentReading ?? undefined, priorityScore: u.priorityScore, priorityParts: u.priorityParts ?? undefined } });
  },
});

export const followUpTask = define({
  name: "follow_up_task",
  description: "Create a task for the company owner when a person was emailed a week or more ago and hasn't replied, and no task is open for them.",
  input: z.object({ contactId: z.string().min(5).max(40), accountId: z.string().min(5).max(40), days: z.number().int().min(1).max(90) }),
  level: 1,
  minRole: "rep",
  reversible: true,
  target: ({ accountId, contactId }) => ({ accountId, contactId }),
  run: async ({ contactId, accountId, days }) => {
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { fullName: true, account: { select: { name: true, ownerId: true } } } });
    if (!c) throw new Error("Person not found");
    const t = await db.task.create({
      data: { title: `Follow up with ${c.fullName} (${c.account.name})`, body: `Emailed ${days} days ago with no reply. Suggested: a short, useful follow-up, or a LinkedIn touch. Added by JARVIS.`, accountId, contactId, assigneeId: c.account.ownerId, dueAt: new Date(Date.now() + 86_400_000), origin: "jarvis" },
      select: { id: true },
    });
    return { taskId: t.id, __undo: { taskId: t.id } };
  },
  undo: async (undo) => {
    const r = await db.task.updateMany({ where: { id: (undo as { taskId: string }).taskId, status: "todo" }, data: { status: "cancelled" } });
    if (!r.count) throw new Error("The task was already picked up, so it was left as it is");
  },
});

export const LEVEL1 = [refreshResearch, prepareDrafts, rescore, followUpTask];
