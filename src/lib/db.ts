import { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { NO_CLIENT_MESSAGE, resolveScope, scopeWhere } from "@/lib/scope";

// Every query a signed-in person makes is limited to the clients they are assigned to
// (Super Admin: all clients, or the one picked). The filter is added here, once, so no
// page or helper can forget it. Background work (cron, queue, API key) is not scoped.

const READ_WRITE = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany", "upsert"]);

function andWhere(where: Record<string, unknown> | undefined, extra: Record<string, unknown>) {
  if (!where) return extra;
  const and = where.AND == null ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...and, extra] };
}

export const db = baseDb.$extends({
  name: "client-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const scope = await resolveScope();
        if (!scope) return query(args);
        const a = (args ?? {}) as Record<string, unknown>;
        if (model === "Account" && (operation === "create" || operation === "upsert")) {
          const data = (operation === "create" ? a.data : a.create) as Record<string, unknown>;
          const sid = (data.sellerId as string | undefined) ?? scope.active;
          if (!sid) throw new Error(NO_CLIENT_MESSAGE);
          if (scope.ids && !scope.ids.includes(sid)) throw new Error("You are not assigned to that client");
          data.sellerId = sid;
        }
        if (model === "ImportBatch" && operation === "create") {
          const data = a.data as Record<string, unknown>;
          data.sellerId ??= scope.active;
          if (!data.sellerId) throw new Error(NO_CLIENT_MESSAGE);
        }
        if (scope.ids && READ_WRITE.has(operation)) {
          const extra = scopeWhere(model as Prisma.ModelName, scope.ids);
          if (extra) a.where = andWhere(a.where as Record<string, unknown> | undefined, extra);
        }
        return query(a as typeof args);
      },
    },
  },
});

export type Db = typeof db;
