// Chat that acts, safely: a changing tool asked for in chat becomes a proposal (status
// awaiting_approval). It runs only when the person confirms it, through the same engine and
// gate, and at most once.
import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { db } from "@/lib/db";
import { authorize, type PolicyDeps } from "./policy";
import { CHAT_PROPOSABLE, REGISTRY } from "./registry";
import { runAgentTool } from "./execute";
import type { AgentContext, Level } from "./types";

export interface Proposal { id: string; tool: string; summary: string; costUsd: number; reversible: boolean; status: string; outcome?: string | null }

const PROPOSAL_TTL_MS = 24 * 3_600_000;
const VERB: Record<string, string> = { refresh_research: "Research again", rescore: "Re-score", prepare_drafts: "Write first-email drafts for", follow_up_task: "Create a follow-up task for", find_people: "Find more people at", approve_drafts: "Approve" };

/** A sentence a person can say yes to, naming the companies and people involved. */
export async function describe(tool: string, input: Record<string, unknown>): Promise<string> {
  const verb = VERB[tool] ?? tool;
  if (tool === "approve_drafts") {
    const ids = (input.draftIds as string[]) ?? [];
    const ds = await db.draft.findMany({ where: { id: { in: ids } }, select: { contact: { select: { fullName: true, account: { select: { name: true } } } } } });
    const names = ds.map((d) => `${d.contact.fullName} (${d.contact.account.name})`);
    return `${verb} ${ids.length} email${ids.length === 1 ? "" : "s"}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}`;
  }
  if (tool === "follow_up_task" && input.contactId) {
    const c = await db.contact.findUnique({ where: { id: String(input.contactId) }, select: { fullName: true } });
    return `${verb} ${c?.fullName ?? "this person"}`;
  }
  const a = input.accountId ? await db.account.findUnique({ where: { id: String(input.accountId) }, select: { name: true } }) : null;
  return `${verb} ${a?.name ?? "this company"}`;
}

/** Turn a chat request for a changing tool into a proposal. Refused up front if it could not run. */
export async function proposeAction(name: string, rawInput: unknown, ctx: AgentContext, reason: string, deps?: PolicyDeps): Promise<{ ok: true; proposal: Proposal } | { ok: false; message: string }> {
  const tool = REGISTRY[name];
  if (!tool || !CHAT_PROPOSABLE.has(name)) return { ok: false, message: `${name} can't be done from chat.` };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, message: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const input = parsed.data as Record<string, unknown>;
  const verdict = await authorize(tool, input, { ...ctx, maxLevel: tool.level as Level }, deps ?? (await defaultDeps()));
  if (!verdict.ok) return { ok: false, message: verdict.reason };
  const summary = await describe(name, input);
  const cost = tool.estimateCostUsd?.(input as never) ?? 0;
  const target = tool.target?.(input as never) ?? {};
  const row = await baseDb.agentAction.create({
    data: { sellerId: ctx.sellerId, accountId: target.accountId ?? null, contactId: target.contactId ?? null, conversationId: ctx.conversationId ?? null, tool: name, level: tool.level, actor: ctx.actor, origin: "chat", reason: reason.slice(0, 500), evidenceIds: [], input: input as Prisma.InputJsonValue, result: { summary, estimateUsd: cost }, reversible: tool.reversible, costUsd: 0, status: "awaiting_approval", idempotencyKey: `proposal:${ctx.sellerId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}` },
    select: { id: true },
  });
  return { ok: true, proposal: { id: row.id, tool: name, summary, costUsd: cost, reversible: tool.reversible, status: "awaiting_approval" } };
}

async function defaultDeps(): Promise<PolicyDeps> {
  const { aiPause } = await import("@/lib/admin/ai-pause");
  const { ensureMonthlyBudget } = await import("@/lib/budget");
  return { aiPaused: async () => Boolean(await aiPause()), budgetOk: (sellerId, usd) => ensureMonthlyBudget(sellerId, usd).then(() => true, () => false) };
}

/** Run a proposal the person confirmed. Re-checks everything now; confirming twice runs once. */
export async function confirmProposal(id: string, ctx: Omit<AgentContext, "maxLevel" | "trigger" | "origin">, deps?: PolicyDeps, now = new Date()): Promise<{ ok: boolean; message: string; status: string }> {
  const p = await baseDb.agentAction.findUnique({ where: { id } });
  if (!p || p.sellerId !== ctx.sellerId) return { ok: false, message: "Proposal not found", status: "missing" };
  if (p.status !== "awaiting_approval") return { ok: p.status === "done", message: p.status === "done" ? "Already done" : `This proposal is ${p.status}`, status: p.status };
  if (now.getTime() - p.createdAt.getTime() > PROPOSAL_TTL_MS) {
    await baseDb.agentAction.update({ where: { id }, data: { status: "cancelled", error: "Expired before it was confirmed" } });
    return { ok: false, message: "This proposal is more than a day old. Ask again so Vega checks the latest data.", status: "cancelled" };
  }
  const claimed = await baseDb.agentAction.updateMany({ where: { id, status: "awaiting_approval" }, data: { status: "running", startedAt: now } });
  if (!claimed.count) return { ok: false, message: "Already being handled", status: "running" };
  const out = await runAgentTool(p.tool, p.input, { ...ctx, origin: "chat", maxLevel: p.level as Level, trigger: `proposal:${p.id}`, conversationId: p.conversationId }, p.reason, deps);
  const message = outcomeText(p.tool, out.status, out.result);
  await baseDb.agentAction.update({ where: { id }, data: { status: out.status === "done" ? "done" : out.status === "refused" ? "cancelled" : "failed", doneAt: new Date(), result: { ...((p.result as object | null) ?? {}), ranAs: out.actionId, outcome: message }, error: out.status === "done" ? null : message.slice(0, 300) } });
  return { ok: out.status === "done", message, status: out.status };
}

export async function dismissProposal(id: string, sellerId: string): Promise<boolean> {
  const r = await baseDb.agentAction.updateMany({ where: { id, sellerId, status: "awaiting_approval" }, data: { status: "cancelled", error: "Dismissed" } });
  return r.count > 0;
}

/** What actually happened, in words: queued work is never described as finished. */
export function outcomeText(tool: string, status: string, result: unknown): string {
  if (status === "refused" || status === "failed") return typeof result === "string" ? result : "It didn't go through.";
  const r = (result ?? {}) as { queued?: boolean; note?: string; approved?: number; of?: number; results?: { who: string; ok: boolean; message: string }[]; before?: number | null; after?: number | null; taskId?: string };
  if (tool === "approve_drafts") {
    const failed = (r.results ?? []).filter((x) => !x.ok);
    return `Approved ${r.approved ?? 0} of ${r.of ?? 0}; they go out with the next send.${failed.length ? ` Not approved: ${failed.map((f) => `${f.who}: ${f.message}`).join("; ")}` : ""}`;
  }
  if (tool === "rescore") return `Re-scored: priority ${r.before ?? "—"} → ${r.after ?? "—"}.`;
  if (tool === "follow_up_task") return "Task created for the owner.";
  if (r.queued === false) return `Not started: ${r.note ?? "nothing to do"}.`;
  return tool === "prepare_drafts" ? "Queued: drafts are being written in the background and will appear in Approvals." : tool === "find_people" ? "Queued: the people search runs in the background; new people appear on the company page." : "Queued: research runs in the background; new facts appear on the company page.";
}

/** Live status of the proposals behind some actions (for reloading a conversation). */
export async function proposalsByIds(ids: string[]): Promise<Proposal[]> {
  if (!ids.length) return [];
  const rows = await baseDb.agentAction.findMany({ where: { id: { in: ids }, status: { in: ["awaiting_approval", "running", "done", "failed", "cancelled"] }, origin: "chat", level: { gt: 0 } }, select: { id: true, tool: true, result: true, costUsd: true, reversible: true, status: true } });
  return rows.map((r) => ({ id: r.id, tool: r.tool, summary: (r.result as { summary?: string } | null)?.summary ?? r.tool, costUsd: (r.result as { estimateUsd?: number } | null)?.estimateUsd ?? 0, reversible: r.reversible, status: r.status, outcome: (r.result as { outcome?: string } | null)?.outcome ?? null }));
}
