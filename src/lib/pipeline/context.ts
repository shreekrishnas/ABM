// Shared helpers for stages: event log, cost ledger with budget enforcement,
// review queue, watchlist. Every block goes through one of these.

import type { EventOutcome, LedgerKind, Prisma, ReviewType, Tier } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { getAdapters, type Adapters } from "@/lib/adapters";

export class BudgetExceeded extends Error {
  constructor(public accountId: string, public spentUsd: number, public capUsd: number) {
    super(`Budget reached: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`);
  }
}

/** A stage stops the account's run (block, watch, review) without being an error. */
export class StopRun extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export interface RunContext {
  runId: string;
  now: Date;
  adapters: Adapters;
}

export function newContext(now = new Date()): RunContext {
  return { runId: `run_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, now, adapters: getAdapters() };
}

export async function logEvent(
  ctx: RunContext,
  e: { accountId?: string | null; contactId?: string | null; stage: number; step: string; outcome: EventOutcome; reason?: string; data?: Prisma.InputJsonValue },
) {
  await db.pipelineEvent.create({
    data: {
      accountId: e.accountId ?? null,
      contactId: e.contactId ?? null,
      stage: e.stage,
      step: e.step,
      outcome: e.outcome,
      reason: e.reason,
      data: e.data,
      runId: ctx.runId,
    },
  });
}

const toMicros = (usd: number) => Math.round(usd * 1_000_000);

export async function spentUsd(accountId: string): Promise<number> {
  const agg = await db.ledgerEntry.aggregate({ where: { accountId }, _sum: { amountMicros: true } });
  return (agg._sum.amountMicros ?? 0) / 1_000_000;
}

export function budgetFor(tier: Tier | null): number {
  return CONFIG.budgetsUsd[tier ?? "T3"];
}

/**
 * Charge a paid call to the account. Checks the tier budget first and throws
 * BudgetExceeded instead of spending past the cap.
 */
export async function charge(accountId: string, tier: Tier | null, kind: LedgerKind, usd: number, description: string, stage: number) {
  const cap = budgetFor(tier);
  const spent = await spentUsd(accountId);
  if (spent + usd > cap + 1e-9) throw new BudgetExceeded(accountId, spent, cap);
  await db.ledgerEntry.create({ data: { accountId, kind, amountMicros: toMicros(usd), description, stage } });
}

/** Record a cost already incurred (e.g. a search that just ran). Never throws on the cap. */
export async function recordCost(accountId: string, kind: LedgerKind, usd: number, description: string, stage: number) {
  if (usd <= 0) return;
  await db.ledgerEntry.create({ data: { accountId, kind, amountMicros: toMicros(usd), description, stage } });
}

/** Throws BudgetExceeded if `usd` more would pass the tier cap. */
export async function ensureBudget(accountId: string, tier: Tier | null, usd: number) {
  const cap = budgetFor(tier);
  const spent = await spentUsd(accountId);
  if (spent + usd > cap + 1e-9) throw new BudgetExceeded(accountId, spent, cap);
}

export async function openReview(r: {
  type: ReviewType;
  reason: string;
  stage: number;
  accountId?: string | null;
  contactId?: string | null;
  draftId?: string | null;
  payload?: Prisma.InputJsonValue;
  dueInHours?: number;
}) {
  // One open item per (type, account, contact, draft) — re-runs don't duplicate the queue.
  const existing = await db.reviewItem.findFirst({
    where: { type: r.type, status: "open", accountId: r.accountId ?? null, contactId: r.contactId ?? null, draftId: r.draftId ?? null },
  });
  if (existing) return existing;
  return db.reviewItem.create({
    data: {
      type: r.type,
      reason: r.reason,
      stage: r.stage,
      accountId: r.accountId ?? null,
      contactId: r.contactId ?? null,
      draftId: r.draftId ?? null,
      payload: r.payload,
      dueAt: new Date(Date.now() + (r.dueInHours ?? 48) * 3_600_000),
    },
  });
}

export async function addToWatchlist(accountId: string, reason: string, days: number, now = new Date()) {
  await db.watchlistEntry.updateMany({ where: { accountId, status: { in: ["waiting", "due"] } }, data: { status: "cancelled" } });
  await db.watchlistEntry.create({ data: { accountId, reason, recheckAt: new Date(now.getTime() + days * 86_400_000) } });
}

export async function isSuppressed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  const domain = `@${e.split("@")[1] ?? ""}`;
  const { sha256 } = await import("./crypto");
  const hit = await db.suppression.findFirst({ where: { value: { in: [e, domain, `sha256:${sha256(e)}`] } } });
  return Boolean(hit);
}
