// Super Admin control centre: every client side by side (companies, work waiting, activity,
// spend against cap, health). Read-only; uses the unscoped client because a Super Admin sees all.

import { baseDb } from "@/lib/db-base";
import { monthlyStatus } from "@/lib/budget";

const DAY = 86_400_000;

export interface ClientRow {
  id: string;
  name: string;
  logoUrl: string | null;
  people: number;
  companies: number;
  queued: number;
  blocked: number;
  errors: number;
  waiting: number;
  emails7: number;
  replies7: number;
  added7: number;
  spent: number;
  cap: number | null;
  capState: "ok" | "warn" | "over";
  lastActivity: Date | null;
  health: "ok" | "warn" | "bad";
  issues: string[];
}

const by = <T extends { sellerId: string; _count: number }>(rows: T[]) => new Map(rows.map((r) => [r.sellerId, r._count]));

export async function clientOverview(now = new Date()): Promise<ClientRow[]> {
  const wk = new Date(now.getTime() - 7 * DAY);
  const [clients, companies, queued, blocked, errored, added, month, waitingRows, sentRows, replyRows, lastRows] = await Promise.all([
    baseDb.client.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
    baseDb.account.groupBy({ by: ["sellerId"], where: { mergedIntoId: null }, _count: true }),
    baseDb.account.groupBy({ by: ["sellerId"], where: { mergedIntoId: null, pipelineStatus: "queued" }, _count: true }),
    baseDb.account.groupBy({ by: ["sellerId"], where: { mergedIntoId: null, pipelineStatus: "blocked" }, _count: true }),
    baseDb.account.groupBy({ by: ["sellerId"], where: { mergedIntoId: null, pipelineStatus: "error" }, _count: true }),
    baseDb.account.groupBy({ by: ["sellerId"], where: { mergedIntoId: null, createdAt: { gte: wk } }, _count: true }),
    monthlyStatus(now),
    baseDb.$queryRaw<{ sellerId: string; n: bigint }[]>`SELECT a."sellerId", COUNT(*) n FROM "ReviewItem" r JOIN "Account" a ON a.id = r."accountId" WHERE r.status = 'open' GROUP BY 1`,
    baseDb.$queryRaw<{ sellerId: string; n: bigint }[]>`SELECT a."sellerId", COUNT(*) n FROM "Message" m JOIN "Contact" c ON c.id = m."contactId" JOIN "Account" a ON a.id = c."accountId" WHERE m."sentAt" >= ${wk} GROUP BY 1`,
    baseDb.$queryRaw<{ sellerId: string; n: bigint }[]>`SELECT a."sellerId", COUNT(*) n FROM "Reply" r JOIN "Contact" c ON c.id = r."contactId" JOIN "Account" a ON a.id = c."accountId" WHERE r."receivedAt" >= ${wk} GROUP BY 1`,
    baseDb.$queryRaw<{ sellerId: string; at: Date }[]>`SELECT a."sellerId", MAX(e."createdAt") at FROM "PipelineEvent" e JOIN "Account" a ON a.id = e."accountId" GROUP BY 1`,
  ]);
  const num = (rows: { sellerId: string; n: bigint }[]) => new Map(rows.map((r) => [r.sellerId, Number(r.n)]));
  const [cCompanies, cQueued, cBlocked, cErr, cAdded] = [by(companies), by(queued), by(blocked), by(errored), by(added)];
  const [cWaiting, cSent, cReplies] = [num(waitingRows), num(sentRows), num(replyRows)];
  const cLast = new Map(lastRows.map((r) => [r.sellerId, r.at]));
  return clients.map((c) => {
    const m = month.get(c.id);
    const row: ClientRow = {
      id: c.id, name: c.name, logoUrl: c.logoUrl, people: c._count.users,
      companies: cCompanies.get(c.id) ?? 0, queued: cQueued.get(c.id) ?? 0, blocked: cBlocked.get(c.id) ?? 0, errors: cErr.get(c.id) ?? 0,
      waiting: cWaiting.get(c.id) ?? 0, emails7: cSent.get(c.id) ?? 0, replies7: cReplies.get(c.id) ?? 0, added7: cAdded.get(c.id) ?? 0,
      spent: m?.spent ?? 0, cap: m?.cap ?? null, capState: m?.state ?? "ok", lastActivity: cLast.get(c.id) ?? null, health: "ok", issues: [],
    };
    if (row.capState === "over") row.issues.push("Monthly cap reached: research paused");
    else if (row.capState === "warn") row.issues.push(`${Math.round(((m?.share ?? 0) * 100))}% of monthly cap used`);
    if (row.errors) row.issues.push(`${row.errors} compan${row.errors === 1 ? "y" : "ies"} failed`);
    if (row.companies && row.blocked / row.companies > 0.4) row.issues.push(`${row.blocked} of ${row.companies} companies stopped`);
    if (row.waiting > 20) row.issues.push(`${row.waiting} approvals waiting`);
    if (!row.people) row.issues.push("Nobody assigned");
    if (row.companies && (!row.lastActivity || now.getTime() - row.lastActivity.getTime() > 7 * DAY)) row.issues.push("No activity for a week");
    row.health = row.capState === "over" || row.errors ? "bad" : row.issues.length ? "warn" : "ok";
    return row;
  });
}
