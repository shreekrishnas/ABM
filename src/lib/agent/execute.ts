// Runs one Vega tool call: decide (policy), log, run scoped to the client, record the real
// outcome. The same call twice (same client, tool, input and trigger) runs once.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { withScope } from "@/lib/scope";
import { authorize, type PolicyDeps, type Verdict } from "./policy";
import { REGISTRY } from "./registry";
import type { ActionStatus, AgentContext } from "./types";

export interface ToolOutcome { actionId: string | null; tool: string; status: ActionStatus | "refused"; result: unknown; refusal?: Extract<Verdict, { ok: false }>; reused?: boolean }

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

export function idempotencyKey(ctx: Pick<AgentContext, "sellerId" | "trigger">, tool: string, input: unknown) {
  return createHash("sha256").update(`${ctx.sellerId}|${tool}|${stable(input ?? {})}|${ctx.trigger ?? ""}`).digest("hex");
}

const defaultDeps = async (): Promise<PolicyDeps> => {
  const { aiPause } = await import("@/lib/admin/ai-pause");
  const { ensureMonthlyBudget } = await import("@/lib/budget");
  return {
    aiPaused: async () => Boolean(await aiPause()),
    budgetOk: (sellerId, usd) => ensureMonthlyBudget(sellerId, usd).then(() => true, () => false),
  };
};

/** Read-only tools (level 0) are logged but never deduplicated: a question asked twice deserves fresh data. */
export async function runAgentTool(name: string, rawInput: unknown, ctx: AgentContext, reason: string, deps?: PolicyDeps): Promise<ToolOutcome> {
  const tool = REGISTRY[name];
  if (!tool) return { actionId: null, tool: name, status: "refused", result: `Unknown tool ${name}`, refusal: { ok: false, code: "level", reason: `Unknown tool ${name}` } };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { actionId: null, tool: name, status: "failed", result: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const input = parsed.data;
  const verdict = await authorize(tool, input, ctx, deps ?? (await defaultDeps()));
  if (!verdict.ok) return { actionId: null, tool: name, status: "refused", result: verdict.reason, refusal: verdict };

  const key = tool.level === 0 ? `${idempotencyKey(ctx, name, input)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` : idempotencyKey(ctx, name, input);
  if (tool.level > 0) {
    const seen = await baseDb.agentAction.findUnique({ where: { idempotencyKey: key }, select: { id: true, status: true, result: true } });
    if (seen) return { actionId: seen.id, tool: name, status: seen.status as ActionStatus, result: seen.result, reused: true };
  }
  const target = tool.target?.(input) ?? {};
  const row = await baseDb.agentAction.create({
    data: {
      sellerId: ctx.sellerId, accountId: target.accountId ?? null, contactId: target.contactId ?? null, conversationId: ctx.conversationId ?? null,
      tool: name, level: tool.level, actor: ctx.actor, origin: ctx.origin, reason: reason.slice(0, 500), evidenceIds: [],
      input: input as Prisma.InputJsonValue, reversible: tool.reversible, status: "running", idempotencyKey: key, startedAt: new Date(),
    },
    select: { id: true },
  });
  try {
    const result = await Promise.race([
      withScope({ ids: [ctx.sellerId], active: ctx.sellerId, choices: [], all: false }, () => tool.run(input, ctx)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("took longer than 20 s")), 20_000)),
    ]);
    const evidenceIds = collectEvidenceIds(result);
    // A tool hands back what Undo needs as __undo; it is stored apart from the result.
    const undo = result && typeof result === "object" && "__undo" in result ? (result as { __undo: unknown }).__undo : undefined;
    const shown = undo === undefined ? result : Object.fromEntries(Object.entries(result as object).filter(([k]) => k !== "__undo"));
    await baseDb.agentAction.update({ where: { id: row.id }, data: { status: "done", doneAt: new Date(), evidenceIds, result: summarise(shown), ...(undo !== undefined ? { undo: undo as Prisma.InputJsonValue } : {}), costUsd: tool.estimateCostUsd?.(input as never) ?? 0 } });
    return { actionId: row.id, tool: name, status: "done", result: shown };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
    await baseDb.agentAction.update({ where: { id: row.id }, data: { status: "failed", doneAt: new Date(), error: msg } }).catch(() => undefined);
    return { actionId: row.id, tool: name, status: "failed", result: `Failed: ${msg}` };
  }
}

/** Fact ids a result rests on (rows under a "facts" list), kept on the action for "why?". */
function collectEvidenceIds(result: unknown): string[] {
  const facts = (result as { facts?: { id?: unknown }[] } | null)?.facts;
  return Array.isArray(facts) ? facts.map((f) => f?.id).filter((x): x is string => typeof x === "string").slice(0, 50) : [];
}

/** What is stored of a result: small, so the log stays light. Full results live only in the conversation. */
function summarise(result: unknown): Prisma.InputJsonValue {
  const s = JSON.stringify(result ?? null);
  return (s.length <= 4000 ? JSON.parse(s) : { truncated: true, preview: s.slice(0, 4000) }) as Prisma.InputJsonValue;
}

/**
 * Undo one finished action, if its tool allows it and its effect can still be reversed.
 * The original row only changes status; the undo itself is logged as its own row.
 */
export async function undoAgentAction(actionId: string, actor: string): Promise<{ ok: boolean; message: string }> {
  const a = await baseDb.agentAction.findUnique({ where: { id: actionId } });
  if (!a) return { ok: false, message: "Action not found" };
  if (a.status !== "done") return { ok: false, message: a.status === "undone" ? "Already undone" : "Only finished actions can be undone" };
  const tool = REGISTRY[a.tool];
  if (!a.reversible || !tool?.undo || a.undo == null) return { ok: false, message: "This action can't be undone" };
  try {
    await withScope({ ids: [a.sellerId], active: a.sellerId, choices: [], all: false }, () => tool.undo!(a.undo, { sellerId: a.sellerId, actor, origin: "chat", maxLevel: 1 }));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Undo failed" };
  }
  await baseDb.$transaction([
    baseDb.agentAction.update({ where: { id: a.id }, data: { status: "undone" } }),
    baseDb.agentAction.create({ data: { sellerId: a.sellerId, accountId: a.accountId, contactId: a.contactId, tool: `undo:${a.tool}`, level: a.level, actor, origin: "chat", reason: `Undid: ${a.reason}`.slice(0, 500), evidenceIds: [], input: { actionId: a.id }, result: { reverses: a.id }, status: "done", idempotencyKey: `undo:${a.id}`, startedAt: new Date(), doneAt: new Date() } }),
  ]);
  return { ok: true, message: "Undone" };
}
