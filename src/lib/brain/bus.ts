// Signal bus. Brain modules never call each other directly: each publishes a typed
// signal when it finishes, and anything that cares subscribes. Every signal is stored
// with the run, the seller and the pack version, so a run can be replayed and audited.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sellerContext } from "@/lib/seller";
import type { RunContext } from "@/lib/pipeline/context";

export const SIGNALS = [
  "seller.context", // Seller context module loaded and validated the pack
  "run.planned", // Main brain: modules, order, budget, loop caps
  "intake.done", // Gap fill finished
  "fit.scored",
  "research.planned",
  "research.done",
  "evidence.judged", // Evidence judge: strong / weak, verified and usable triggers
  "intent.scored", // Intent engine: converging signal families, score, why now
  "brief.ready", // Strategist verdict
  "verdict.conflict", // Two modules disagree; the main brain resolved it
  "buying_group.ready",
  "readiness.decided",
  "draft.critiqued", // Critic panel verdict on one version of a draft
  "draft.rewritten",
  "draft.ready",
  "send.held", // Email channel refused to send (fence)
  "run.finished",
  "learning.summary",
  "proposal.created",
] as const;
export type SignalType = (typeof SIGNALS)[number];

export interface Signal<P = Record<string, unknown>> {
  id: string;
  runId: string;
  accountId: string | null;
  type: SignalType;
  module: string;
  payload: P;
  sellerId: string;
  packVersion: string;
  createdAt: Date;
}

type Handler = (s: Signal, ctx: RunContext) => Promise<void> | void;
const handlers = new Map<SignalType, Handler[]>();

export function subscribe(type: SignalType, handler: Handler): () => void {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
  return () => handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
}

export async function publish<P extends Record<string, unknown>>(ctx: RunContext, s: { type: SignalType; module: string; accountId?: string | null; payload: P }): Promise<Signal<P>> {
  const { pack, version } = sellerContext();
  const row = await db.brainSignal.create({
    data: { runId: ctx.runId, accountId: s.accountId ?? null, type: s.type, module: s.module, payload: s.payload as unknown as Prisma.InputJsonValue, sellerId: pack.id, packVersion: version, createdAt: ctx.now },
  });
  const signal = { ...row, type: s.type, payload: s.payload } as Signal<P>;
  for (const h of handlers.get(s.type) ?? []) await h(signal as Signal, ctx);
  return signal;
}

/** Every signal for an account (or one run), in order — the run, replayed. */
export async function replay(where: { accountId?: string; runId?: string }): Promise<Signal[]> {
  const rows = await db.brainSignal.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows as unknown as Signal[];
}
