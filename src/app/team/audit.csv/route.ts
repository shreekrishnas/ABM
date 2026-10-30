import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { auditCsv } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/** Super Admin only: the audit log (with the page's filters) as a CSV file. */
export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.superAdmin) return new Response("Not found", { status: 404 });
  const p = new URL(req.url).searchParams;
  const where: Prisma.AuditEntryWhereInput = { ...(p.get("who") ? { actorEmail: p.get("who")! } : {}), ...(p.get("what") ? { action: p.get("what")! } : {}), ...(p.get("account") ? { clientId: p.get("account")! } : {}) };
  const [rows, clients] = await Promise.all([db.auditEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: 10_000 }), db.client.findMany({ select: { id: true, name: true } })]);
  return new Response(auditCsv(rows, new Map(clients.map((c) => [c.id, c.name]))), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
}
