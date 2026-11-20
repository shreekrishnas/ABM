// The Level 1 loop: for each client with JARVIS switched on, find work worth doing, rank it,
// keep within the client's daily cap and cooldowns, and run it through the shared engine.
// Rules decide; nothing here asks a model what to do.
import { baseDb } from "@/lib/db-base";
import { withScope } from "@/lib/scope";
import { db } from "@/lib/db";
import { runAgentTool } from "./execute";
import { REGISTRY } from "./registry";
import { SYSTEM_ACTOR, type AgentContext } from "./types";

const DAY = 86_400_000;
export const L1_TOOLS = ["rescore", "refresh_research", "prepare_drafts", "follow_up_task"] as const;
export type L1Tool = (typeof L1_TOOLS)[number];

export interface Candidate { tool: L1Tool; input: Record<string, unknown>; reason: string; priority: number; key: string }

const tierWeight = (t: string | null) => (t === "T1" ? 3 : t === "T2" ? 2 : 1);
const today = (now: Date) => now.toISOString().slice(0, 10);

/** Work worth doing for the client in scope right now. Pure reads. */
export async function findCandidates(now = new Date()): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const live = { mergedIntoId: null, stage: { notIn: ["DISQUALIFIED", "CUSTOMER"] as ("DISQUALIFIED" | "CUSTOMER")[] } };

  // 1. New signals since the company's reading was last updated → re-score.
  const recent = await db.signal.findMany({ where: { occurredAt: { gte: new Date(now.getTime() - DAY) }, account: live }, select: { accountId: true, type: true, account: { select: { tier: true, name: true, updatedAt: true } } }, take: 200 });
  const bySignal = new Map<string, { n: number; types: Set<string>; tier: string | null; name: string }>();
  for (const s of recent) {
    if (!s.accountId || !s.account) continue;
    const e = bySignal.get(s.accountId) ?? { n: 0, types: new Set(), tier: s.account.tier, name: s.account.name };
    e.n++; e.types.add(s.type); bySignal.set(s.accountId, e);
  }
  for (const [accountId, e] of bySignal) out.push({ tool: "rescore", input: { accountId }, reason: `${e.n} new signal${e.n === 1 ? "" : "s"} for ${e.name} (${[...e.types].join(", ").replaceAll("_", " ")}) since its last reading`, priority: 2 + tierWeight(e.tier) + Math.min(e.n, 3), key: `${accountId}:${today(now)}` });

  // 2. Priority companies whose newest research is older than 90 days → refresh.
  const priority = await db.account.findMany({ where: { ...live, tier: { in: ["T1", "T2"] }, pipelineStatus: { in: ["idle", "done"] } }, select: { id: true, name: true, tier: true, evidence: { where: { isNegative: false }, orderBy: { publishedAt: "desc" }, take: 1, select: { publishedAt: true } } }, take: 200 });
  for (const a of priority) {
    const newest = a.evidence[0]?.publishedAt;
    if (!newest) continue;
    const age = Math.floor((now.getTime() - newest.getTime()) / DAY);
    if (age > 90) out.push({ tool: "refresh_research", input: { accountId: a.id }, reason: `${a.name}'s newest research is ${age} days old (refresh after 90)`, priority: 1 + tierWeight(a.tier), key: `${a.id}:week-${Math.floor(now.getTime() / (7 * DAY))}` });
  }

  // 3. People marked ready with no draft and no message → prepare drafts (into Approvals).
  const ready = await db.contact.findMany({ where: { readiness: "ready", mergedIntoId: null, state: { notIn: ["suppressed", "do_not_contact"] }, drafts: { none: {} }, messages: { none: {} }, account: { ...live, doNotContact: false, pipelineStatus: { in: ["idle", "done"] } } }, select: { accountId: true, account: { select: { name: true, tier: true } } }, take: 200 });
  const readyBy = new Map<string, { n: number; name: string; tier: string | null }>();
  for (const c of ready) { const e = readyBy.get(c.accountId) ?? { n: 0, name: c.account.name, tier: c.account.tier }; e.n++; readyBy.set(c.accountId, e); }
  for (const [accountId, e] of readyBy) out.push({ tool: "prepare_drafts", input: { accountId }, reason: `${e.n} ready ${e.n === 1 ? "person has" : "people have"} no draft yet at ${e.name}`, priority: 2 + tierWeight(e.tier), key: `${accountId}:${today(now)}` });

  // 4. Emailed 7+ days ago, no reply since, no open task → follow-up task.
  const sent = await db.message.findMany({ where: { sentAt: { lte: new Date(now.getTime() - 7 * DAY), gte: new Date(now.getTime() - 30 * DAY) }, contact: { replies: { none: {} }, tasks: { none: { status: { in: ["todo", "in_progress"] } } }, state: { notIn: ["suppressed", "do_not_contact"] }, account: live } }, orderBy: { sentAt: "desc" }, select: { contactId: true, sentAt: true, contact: { select: { fullName: true, accountId: true, account: { select: { tier: true } } } } }, take: 200 });
  const seen = new Set<string>();
  for (const m of sent) {
    if (seen.has(m.contactId) || !m.sentAt) continue;
    seen.add(m.contactId);
    const days = Math.floor((now.getTime() - m.sentAt.getTime()) / DAY);
    out.push({ tool: "follow_up_task", input: { contactId: m.contactId, accountId: m.contact.accountId, days }, reason: `${m.contact.fullName} was emailed ${days} days ago and hasn't replied`, priority: 1 + tierWeight(m.contact.account.tier), key: `${m.contactId}:${m.sentAt.toISOString().slice(0, 10)}` });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export interface LoopReport { sellerId: string; skipped?: string; ran: { tool: string; status: string; reason: string }[]; capLeftUsd: number }

/** One pass for one client. Respects the switch, allowed actions, the daily cap and a per-run limit. */
export async function runClientLoop(sellerId: string, now = new Date(), opts: { maxActions?: number } = {}): Promise<LoopReport> {
  const setting = await baseDb.agentSetting.findUnique({ where: { sellerId } });
  if (!setting?.enabled) return { sellerId, skipped: "JARVIS is off for this client", ran: [], capLeftUsd: 0 };
  if (setting.paused) return { sellerId, skipped: "JARVIS is paused for this client", ran: [], capLeftUsd: 0 };
  const allowed = new Set(Array.isArray(setting.allowedTools) ? (setting.allowedTools as string[]) : []);
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const spent = await baseDb.agentAction.aggregate({ where: { sellerId, createdAt: { gte: dayStart }, level: { gt: 0 } }, _sum: { costUsd: true } });
  let capLeft = setting.dailyCapUsd - (spent._sum.costUsd ?? 0);
  const scope = { ids: [sellerId], active: sellerId, choices: [], all: false };
  const candidates = (await withScope(scope, () => findCandidates(now))).filter((c) => allowed.has(c.tool));
  const ran: LoopReport["ran"] = [];
  const max = opts.maxActions ?? 10;
  for (const c of candidates) {
    if (ran.length >= max) break;
    const cost = REGISTRY[c.tool]?.estimateCostUsd?.(c.input as never) ?? 0;
    if (cost > capLeft) continue;
    const ctx: AgentContext = { sellerId, actor: SYSTEM_ACTOR, origin: "loop", maxLevel: 1, trigger: `loop:${c.tool}:${c.key}` };
    const out = await runAgentTool(c.tool, c.input, ctx, c.reason);
    if (out.reused) continue;
    if (out.status === "done") capLeft -= cost;
    ran.push({ tool: c.tool, status: out.status, reason: c.reason });
  }
  // Queued research and drafts run in the background queue.
  if (ran.some((r) => r.status === "done" && (r.tool === "refresh_research" || r.tool === "prepare_drafts"))) {
    const { kickDrain } = await import("@/lib/queue/drain");
    await kickDrain(process.env.APP_URL ?? null).catch(() => false);
  }
  return { sellerId, ran, capLeftUsd: Math.max(0, Math.round(capLeft * 100) / 100) };
}

/** Budget brake check: the first time this month a client passes 90% of its monthly budget. */
async function checkBudgets(now: Date) {
  const { monthlyStatus } = await import("@/lib/budget");
  const { emitEvent } = await import("./events");
  const status = await monthlyStatus(now).catch(() => new Map());
  for (const [sellerId, s] of status) if (s.share != null && s.share >= 0.9) await emitEvent(sellerId, "budget90", { share: s.share }, `budget90:${sellerId}:${now.toISOString().slice(0, 7)}`);
}

/** Every client with JARVIS on. Events are handled first (opt-outs and the budget brake for every client). */
export async function runLoop(now = new Date()): Promise<LoopReport[]> {
  await checkBudgets(now);
  const { processEvents } = await import("./events");
  await processEvents().catch(() => undefined);
  const on = await baseDb.agentSetting.findMany({ where: { enabled: true, paused: false }, select: { sellerId: true } });
  const out: LoopReport[] = [];
  for (const s of on) out.push(await runClientLoop(s.sellerId, now).catch((e) => ({ sellerId: s.sellerId, skipped: `Failed: ${e instanceof Error ? e.message : e}`, ran: [], capLeftUsd: 0 })));
  return out;
}
