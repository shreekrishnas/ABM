import { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { NO_CLIENT_MESSAGE, resolveScope, scopeWhere } from "@/lib/scope";

// Every query a signed-in person makes is limited to the clients they are assigned to
// (Super Admin: all clients, or the one picked). The filter is added here, once, so no
// page or helper can forget it. Background work (cron, queue, API key) is not scoped.

const CREATES = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);
const READ_WRITE = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany", "upsert"]);

function andWhere(where: Record<string, unknown> | undefined, extra: Record<string, unknown>) {
  if (!where) return extra;
  const and = where.AND == null ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...and, extra] };
}

/** Client-owned records with their own sellerId that are created from the app (default: the client in view). */
const OWNED = new Set(["Campaign", "SenderProfile"]);
const WRITES = new Set(["create", "createMany", "createManyAndReturn", "upsert", "update", "updateMany"]);

/** The records a write's data points at: refuse one that exists and belongs to a client out of view. */
async function assertParentsInScope(a: Record<string, unknown>, operation: string, ids: string[]) {
  const rows = (operation === "upsert" ? [a.create, a.update] : Array.isArray(a.data) ? a.data : [a.data]).filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object");
  const pick = (d: Record<string, unknown>, field: string, relation: string): string | null => {
    const v = d[field];
    if (typeof v === "string") return v;
    const rel = d[relation] as { connect?: { id?: unknown } } | undefined;
    return typeof rel?.connect?.id === "string" ? rel.connect.id : null;
  };
  const accountIds = new Set<string>(), contactIds = new Set<string>(), journeyIds = new Set<string>(), sellerIds = new Set<string>();
  for (const d of rows) {
    const acc = pick(d, "accountId", "account"), con = pick(d, "contactId", "contact"), jou = pick(d, "journeyId", "journey");
    if (acc) accountIds.add(acc);
    if (con) contactIds.add(con);
    if (jou) journeyIds.add(jou);
    if (typeof d.sellerId === "string") sellerIds.add(d.sellerId);
  }
  const out = (sid: string | null | undefined) => typeof sid === "string" && !ids.includes(sid);
  if ([...sellerIds].some(out)) throw new Error("You are not assigned to that client");
  const [accs, cons, jous] = await Promise.all([
    accountIds.size ? baseDb.account.findMany({ where: { id: { in: [...accountIds] } }, select: { sellerId: true } }) : [],
    contactIds.size ? baseDb.contact.findMany({ where: { id: { in: [...contactIds] } }, select: { account: { select: { sellerId: true } } } }) : [],
    journeyIds.size ? baseDb.journey.findMany({ where: { id: { in: [...journeyIds] } }, select: { contact: { select: { account: { select: { sellerId: true } } } } } }) : [],
  ]);
  // Only an existing record of another client is refused: one created in the same transaction isn't visible here yet.
  if (accs.some((x) => out(x.sellerId)) || cons.some((x) => out(x.account?.sellerId)) || jous.some((x) => out(x.contact?.account?.sellerId))) {
    throw new Error("You are not assigned to that client");
  }
}

export const db = baseDb.$extends({
  name: "client-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const scope = await resolveScope();
        if (!scope) return query(args);
        const a = (args ?? {}) as Record<string, unknown>;
        // No client in view (none assigned, all removed, or a session that no longer works): nothing of
        // any client's may be created either. Reads, updates and deletes already match nothing.
        if (scope.ids && !scope.ids.length && CREATES.has(operation) && scopeWhere(model as Prisma.ModelName, [])) throw new Error(NO_CLIENT_MESSAGE);
        if (model === "Account" && (operation === "create" || operation === "upsert")) {
          const data = (operation === "create" ? a.data : a.create) as Record<string, unknown>;
          const sid = (data.sellerId as string | undefined) ?? scope.active;
          if (!sid) throw new Error(NO_CLIENT_MESSAGE);
          if (scope.ids && !scope.ids.includes(sid)) throw new Error("You are not assigned to that client");
          data.sellerId = sid;
        }
        // Records owned directly by a client: default to the client in view; never another client's.
        if (OWNED.has(model) && (operation === "create" || operation === "upsert")) {
          const data = (operation === "create" ? a.data : a.create) as Record<string, unknown>;
          data.sellerId ??= scope.active;
          if (!data.sellerId) throw new Error(NO_CLIENT_MESSAGE);
          if (scope.ids && !scope.ids.includes(data.sellerId as string)) throw new Error("You are not assigned to that client");
        }
        // Whatever a write points at (a company, a person, a journey, a client) must be in view too.
        if (scope.ids && WRITES.has(operation) && scopeWhere(model as Prisma.ModelName, [])) await assertParentsInScope(a, operation, scope.ids);
        if (model === "ImportBatch" && operation === "create") {
          const data = a.data as Record<string, unknown>;
          data.sellerId ??= scope.active;
          if (!data.sellerId) throw new Error(NO_CLIENT_MESSAGE);
          if (scope.ids && !scope.ids.includes(data.sellerId as string)) throw new Error("You are not assigned to that client");
        }
        if (scope.ids && READ_WRITE.has(operation)) {
          const extra = scopeWhere(model as Prisma.ModelName, scope.ids, { platformAdmin: scope.all });
          if (extra) a.where = andWhere(a.where as Record<string, unknown> | undefined, extra);
        }
        return query(a as typeof args);
      },
    },
  },
});

export type Db = typeof db;
