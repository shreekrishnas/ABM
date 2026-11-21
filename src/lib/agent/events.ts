// Vega Level 2 intake: things that happened (a reply, a bounce, a booked meeting, a budget
// threshold) are written once as AgentEvents, then each is handled once through the shared
// engine. The dedupe key makes webhook retries and double clicks harmless.
import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { runAgentTool } from "./execute";
import { REGISTRY } from "./registry";
import { SYSTEM_ACTOR, type AgentContext } from "./types";

export type EventType = "reply" | "hard_bounce" | "meeting" | "budget90";
export interface ReplyPayload { replyId: string; class: string; contactId: string; accountId: string; excerpt: string }

/** Record an event. Never throws into the caller: losing an event must not break a reply or a bounce. */
export async function emitEvent(sellerId: string | null | undefined, type: EventType, payload: Record<string, unknown>, dedupeKey: string): Promise<string | null> {
  if (!sellerId) return null;
  try {
    const e = await baseDb.agentEvent.upsert({ where: { dedupeKey }, create: { sellerId, type, payload: payload as Prisma.InputJsonValue, dedupeKey }, update: {}, select: { id: true } });
    return e.id;
  } catch {
    return null;
  }
}

/** Optional Level 2 reactions a client can switch off. Opt-outs and the budget brake always run. */
export const L2_OPTIONAL = ["hot_reply_handoff", "question_task", "ooo_reschedule", "find_replacement", "meeting_prep"] as const;
export const L2_MANDATORY = ["opt_out_everywhere", "budget_brake"] as const;

/** Which tools an event calls, with their input and the reason shown to people. */
export function plan(type: string, p: Record<string, unknown>): { tool: string; input: Record<string, unknown>; reason: string }[] {
  const name = String(p.name ?? "the contact");
  if (type === "reply") {
    const base = { contactId: p.contactId, accountId: p.accountId };
    switch (p.class) {
      case "unsubscribe": return [{ tool: "opt_out_everywhere", input: { ...base, why: "asked to stop" }, reason: `${name} asked to stop` }];
      case "positive": return [{ tool: "hot_reply_handoff", input: { ...base, excerpt: p.excerpt }, reason: `${name} replied with interest` }];
      case "needs_human":
      case "objection": return [{ tool: "question_task", input: { ...base, excerpt: p.excerpt, kind: p.class }, reason: `${name} sent a reply that needs a person (${p.class === "objection" ? "objection" : "unclear"})` }];
      case "out_of_office": return [{ tool: "ooo_reschedule", input: { contactId: p.contactId, accountId: p.accountId, excerpt: p.excerpt }, reason: `${name} is out of office` }];
      case "wrong_person": return [{ tool: "find_replacement", input: { accountId: p.accountId, contactId: p.contactId }, reason: `${name} says they're the wrong person` }];
      default: return [];
    }
  }
  if (type === "hard_bounce") return [
    { tool: "opt_out_everywhere", input: { contactId: p.contactId, accountId: p.accountId, why: "email bounced" }, reason: `${name}'s email bounced` },
    { tool: "find_replacement", input: { accountId: p.accountId, contactId: p.contactId }, reason: `${name}'s email bounced; looking for someone in the same role` },
  ];
  if (type === "meeting") return [{ tool: "meeting_prep", input: { contactId: p.contactId, accountId: p.accountId, stage: p.stage }, reason: `A ${p.stage === "demo_scheduled" ? "demo" : "call"} is booked with ${name}` }];
  if (type === "budget90") return [{ tool: "budget_brake", input: { share: p.share }, reason: `Monthly spend reached ${Math.round(Number(p.share) * 100)}% of the budget` }];
  return [];
}

async function withinDailyCap(sellerId: string, usd: number) {
  const s = await baseDb.agentSetting.findUnique({ where: { sellerId }, select: { dailyCapUsd: true } });
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const spent = await baseDb.agentAction.aggregate({ where: { sellerId, createdAt: { gte: dayStart }, level: { gt: 0 } }, _sum: { costUsd: true } });
  return (spent._sum.costUsd ?? 0) + usd <= (s?.dailyCapUsd ?? 0);
}

/** Handle every event not yet handled (for one client, or all). Each event acts once. */
export async function processEvents(sellerId?: string, limit = 50): Promise<{ handled: number; actions: number }> {
  const events = await baseDb.agentEvent.findMany({ where: { processedAt: null, ...(sellerId ? { sellerId } : {}) }, orderBy: { createdAt: "asc" }, take: limit });
  let actions = 0;
  const settings = new Map<string, { on: boolean; allowed: Set<string> }>();
  for (const e of events) {
    if (!settings.has(e.sellerId)) {
      const s = await baseDb.agentSetting.findUnique({ where: { sellerId: e.sellerId } });
      settings.set(e.sellerId, { on: Boolean(s?.enabled && !s.paused), allowed: new Set(Array.isArray(s?.allowedTools) ? (s!.allowedTools as string[]) : []) });
    }
    const s = settings.get(e.sellerId)!;
    for (const step of plan(e.type, e.payload as Record<string, unknown>)) {
      const mandatory = (L2_MANDATORY as readonly string[]).includes(step.tool);
      if (!mandatory && !(s.on && s.allowed.has(step.tool))) continue;
      // Paid reactions count against the same daily limit as Level 1 work.
      const cost = REGISTRY[step.tool]?.estimateCostUsd?.(step.input as never) ?? 0;
      if (cost > 0 && !(await withinDailyCap(e.sellerId, cost))) continue;
      const ctx: AgentContext = { sellerId: e.sellerId, actor: SYSTEM_ACTOR, origin: "event", maxLevel: 2, trigger: `event:${e.id}:${step.tool}` };
      const out = await runAgentTool(step.tool, step.input, ctx, step.reason);
      if (out.status === "done" && !out.reused) actions++;
    }
    await baseDb.agentEvent.update({ where: { id: e.id }, data: { processedAt: new Date() } });
  }
  return { handled: events.length, actions };
}
