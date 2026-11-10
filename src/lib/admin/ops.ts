// Operations for Super Admin → System health: run history and companies that stopped, grouped by why.

import { baseDb } from "@/lib/db-base";

/** Record one background run; never throws (logging must not break the run). */
export async function recordRun(job: string, startedAt: Date, r: { ok?: boolean; processed?: number; remaining?: number | null; note?: string | null }) {
  try {
    await baseDb.runLog.create({ data: { job, startedAt, ok: r.ok ?? true, processed: r.processed ?? 0, remaining: r.remaining ?? null, note: r.note?.slice(0, 300) ?? null } });
    // Keep the table small: the newest 500 runs are plenty to see a pattern.
    const old = await baseDb.runLog.findMany({ orderBy: { finishedAt: "desc" }, skip: 500, select: { id: true } });
    if (old.length) await baseDb.runLog.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  } catch {
    // ignore
  }
}

export async function runHistory(limit = 30) {
  return baseDb.runLog.findMany({ orderBy: { finishedAt: "desc" }, take: limit }).catch(() => []);
}

/** Numbers and amounts differ between companies stopped for the same reason: drop them to group. */
export const reasonKey = (r: string) => r.replace(/\$?\d+(?:[.,]\d+)*%?/g, "#").replace(/\s+/g, " ").trim().slice(0, 120);

export type StoppedGroup = { clientId: string; key: string; reason: string; count: number };

/** Companies that stopped (blocked or failed), by client and the reason of their latest stop. */
export async function stoppedGroups(): Promise<StoppedGroup[]> {
  const rows = await baseDb.$queryRaw<{ sellerId: string; reason: string | null; lastError: string | null }[]>`
    SELECT a."sellerId", e.reason, a."lastError"
    FROM "Account" a
    LEFT JOIN LATERAL (
      SELECT pe.reason FROM "PipelineEvent" pe
      WHERE pe."accountId" = a.id AND pe.outcome = 'block'
      ORDER BY pe."createdAt" DESC LIMIT 1
    ) e ON true
    WHERE a."pipelineStatus" IN ('blocked', 'error') AND a."mergedIntoId" IS NULL AND a.stage <> 'DISQUALIFIED'`.catch(() => []);
  const groups = new Map<string, StoppedGroup>();
  for (const r of rows) {
    const reason = (r.reason ?? r.lastError ?? "Stopped without a recorded reason").trim();
    const key = reasonKey(reason);
    const id = `${r.sellerId}|${key}`;
    const g = groups.get(id) ?? { clientId: r.sellerId, key, reason, count: 0 };
    g.count++;
    groups.set(id, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Ids of the companies in one group (same client, same reason key). */
export async function stoppedIds(clientId: string, key: string): Promise<{ id: string; pipelineStage: number }[]> {
  const rows = await baseDb.$queryRaw<{ id: string; pipelineStage: number; reason: string | null; lastError: string | null }[]>`
    SELECT a.id, a."pipelineStage", e.reason, a."lastError"
    FROM "Account" a
    LEFT JOIN LATERAL (
      SELECT pe.reason FROM "PipelineEvent" pe
      WHERE pe."accountId" = a.id AND pe.outcome = 'block'
      ORDER BY pe."createdAt" DESC LIMIT 1
    ) e ON true
    WHERE a."sellerId" = ${clientId} AND a."pipelineStatus" IN ('blocked', 'error') AND a."mergedIntoId" IS NULL AND a.stage <> 'DISQUALIFIED'`;
  return rows.filter((r) => reasonKey((r.reason ?? r.lastError ?? "Stopped without a recorded reason").trim()) === key).map((r) => ({ id: r.id, pipelineStage: r.pipelineStage }));
}
