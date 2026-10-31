// What a Super Admin needs to see that something is wrong: tables the app can't use,
// a background queue that stopped, connected services, and what each account spends.

import { baseDb } from "@/lib/db-base";
import { queueStatus } from "@/lib/queue/drain";
import { serviceStatus } from "@/lib/adapters";
import { recentErrors } from "./errors";

/** Tables the app's database role can't fully read and write (e.g. created by another role without grants). */
export async function tablesWithoutAccess(): Promise<string[]> {
  const rows = await baseDb.$queryRaw<{ t: string }[]>`
    SELECT tablename AS t FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
      AND NOT (
        has_table_privilege(format('%I.%I', schemaname, tablename), 'SELECT')
        AND has_table_privilege(format('%I.%I', schemaname, tablename), 'INSERT')
        AND has_table_privilege(format('%I.%I', schemaname, tablename), 'UPDATE')
        AND has_table_privilege(format('%I.%I', schemaname, tablename), 'DELETE')
      )
    ORDER BY tablename`;
  return rows.map((r) => r.t);
}

/** A queue with work waiting, no worker on it and no run for 10 minutes has stopped. */
export const STUCK_AFTER_MS = 10 * 60_000;
export async function queueHealth(now = new Date()) {
  const q = await queueStatus(now);
  const idleFor = q.lastRunAt ? now.getTime() - q.lastRunAt.getTime() : Infinity;
  return { ...q, stuck: q.queued > 0 && !q.working && idleFor > STUCK_AFTER_MS };
}

/** Research and lookup spend per account: last 30 days and all time, in dollars. */
export async function spendByAccount(now = new Date()): Promise<Map<string, { month: number; total: number; companies: number }>> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await baseDb.$queryRaw<{ sellerId: string; month: bigint | null; total: bigint | null; companies: bigint }[]>`
    SELECT COALESCE(l."sellerId", a."sellerId") AS "sellerId", SUM(l."amountMicros") FILTER (WHERE l."createdAt" >= ${since}) AS month, SUM(l."amountMicros") AS total, COUNT(DISTINCT a.id) AS companies
    FROM "LedgerEntry" l LEFT JOIN "Account" a ON a.id = l."accountId"
    WHERE COALESCE(l."sellerId", a."sellerId") IS NOT NULL
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.sellerId, { month: Number(r.month ?? 0) / 1e6, total: Number(r.total ?? 0) / 1e6, companies: Number(r.companies) }]));
}

export async function systemHealth() {
  const [tables, queue, errors] = await Promise.all([tablesWithoutAccess().catch(() => null), queueHealth(), recentErrors(20).catch(() => [])]);
  return { tables, queue, services: serviceStatus(), errors };
}
