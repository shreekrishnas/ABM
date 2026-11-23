// The people a client's screens may name: team members assigned to the clients in view, and the Super
// Admins who cover them. Owner filters, assignee pickers, task lists and the team card use this, so a
// client never sees the names of people who work only for another client. Names and roles only.

import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { resolveScope } from "@/lib/scope";

export interface PersonInView { id: string; name: string; role: string }

export async function peopleInView(o: { activeOnly?: boolean; where?: Prisma.UserWhereInput } = {}): Promise<PersonInView[]> {
  const scope = await resolveScope();
  const base: Prisma.UserWhereInput = { ...(o.activeOnly === false ? {} : { status: "active" }), ...(o.where ?? {}) };
  // No scope (local previews, background work) or a full Super Admin viewing every client: everyone.
  if (!scope || scope.ids === null) return baseDb.user.findMany({ where: base, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } });
  if (!scope.ids.length) return [];
  return baseDb.user.findMany({
    where: {
      AND: [base, {
        OR: [
          { clients: { some: { clientId: { in: scope.ids } } } },
          { superAdmin: true, superAdminClients: { isEmpty: true } },
          { superAdmin: true, superAdminClients: { hasSome: scope.ids } },
        ],
      }],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}
