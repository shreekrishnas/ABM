// Monthly spending caps per client account. A Super Admin sets the cap in Team & Access;
// research, AI and lookups stop for that account once the month's spend reaches it, and
// everything is shown on System health (warning at 80%).

import { baseDb } from "@/lib/db-base";

/** A paid step would pass a budget: the run stops for that company and a person is told. */
export class BudgetExceeded extends Error {
  constructor(public accountId: string, public spentUsd: number, public capUsd: number) {
    super(`Budget reached: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`);
  }
}

export const WARN_AT = 0.8;

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** This calendar month's spend for an account, in dollars (company costs and account-level costs). */
export async function monthSpendUsd(sellerId: string, now = new Date()): Promise<number> {
  const rows = await baseDb.$queryRaw<{ s: bigint | null }[]>`
    SELECT SUM(l."amountMicros") AS s FROM "LedgerEntry" l LEFT JOIN "Account" a ON a.id = l."accountId"
    WHERE COALESCE(l."sellerId", a."sellerId") = ${sellerId} AND l."createdAt" >= ${monthStart(now)}`;
  return Number(rows[0]?.s ?? 0) / 1e6;
}

export class MonthlyBudgetExceeded extends BudgetExceeded {
  constructor(public sellerId: string, spent: number, cap: number, accountId = "") {
    super(accountId, spent, cap);
    this.message = `Monthly budget reached for this account: $${spent.toFixed(2)} of $${cap.toFixed(2)}. A Super Admin can raise it in Team & Access.`;
  }
}

/** Throws when `usd` more would pass the account's monthly cap. No cap set: never throws. */
export async function ensureMonthlyBudget(sellerId: string | null | undefined, usd: number, accountId = "") {
  if (!sellerId) return;
  const client = await baseDb.client.findUnique({ where: { id: sellerId }, select: { monthlyBudgetUsd: true } });
  const cap = client?.monthlyBudgetUsd;
  if (cap == null) return;
  const spent = await monthSpendUsd(sellerId);
  if (spent + usd > cap + 1e-9) throw new MonthlyBudgetExceeded(sellerId, spent, cap, accountId);
}

/** Each account's month: spend, cap and whether it is near or over the cap. */
export async function monthlyStatus(now = new Date()): Promise<Map<string, { spent: number; cap: number | null; share: number | null; state: "ok" | "warn" | "over" }>> {
  const clients = await baseDb.client.findMany({ select: { id: true, monthlyBudgetUsd: true } });
  const out = new Map<string, { spent: number; cap: number | null; share: number | null; state: "ok" | "warn" | "over" }>();
  for (const c of clients) {
    const spent = await monthSpendUsd(c.id, now);
    const cap = c.monthlyBudgetUsd ?? null;
    const share = cap ? spent / cap : null;
    out.set(c.id, { spent, cap, share, state: share == null ? "ok" : share >= 1 ? "over" : share >= WARN_AT ? "warn" : "ok" });
  }
  return out;
}
