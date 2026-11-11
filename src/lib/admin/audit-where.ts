import type { Prisma } from "@prisma/client";
import { SENSITIVE } from "@/lib/admin/audit";

const day = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);

/** The audit filter shared by the Audit log tab and its CSV export. Dates are whole days (UTC), "to" inclusive. */
export function auditWhere(p: { who?: string | null; what?: string | null; account?: string | null; from?: string | null; to?: string | null; sensitive?: string | null }): Prisma.AuditEntryWhereInput {
  const from = day(p.from);
  const to = day(p.to);
  return {
    ...(p.who ? { actorEmail: p.who } : {}),
    ...(p.what ? { action: p.what } : p.sensitive === "1" ? { action: { in: [...SENSITIVE] } } : {}),
    ...(p.account ? { clientId: p.account } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } } : {}),
  };
}
