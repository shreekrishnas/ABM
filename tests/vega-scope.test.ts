// P8: what Vega's tools and the activity views may read. A company's steps by its client; steps with no
// company (scans, visitor pulls) only by the client they name or a full Super Admin; platform-wide
// records only for a Super Admin covering every client. Mocked data only (no model calls).
import { beforeEach, describe, expect, it } from "vitest";
import { baseDb } from "@/lib/db-base";
import { db } from "@/lib/db";
import { withScope } from "@/lib/scope";
import { toolScope } from "@/lib/agent/execute";

let manchCo = "", betaCo = "";
beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "beta", name: "Beta" }] });
  manchCo = (await baseDb.account.create({ data: { name: "Manch Co", sellerId: "manch" } })).id;
  betaCo = (await baseDb.account.create({ data: { name: "Beta Co", sellerId: "beta" } })).id;
  const ev = (reason: string, accountId: string | null, data?: object) => ({ runId: "run_x", stage: 0, step: "test.step", outcome: "info" as const, reason, accountId, ...(data ? { data } : {}) });
  await baseDb.pipelineEvent.createMany({ data: [
    ev("manch company step", manchCo), ev("beta company step", betaCo),
    ev("manch scan: 12 prospects", null, { sellerId: "manch" }), ev("beta scan: 3 prospects", null, { sellerId: "beta" }),
    ev("platform step, no client", null),
  ] });
  await baseDb.reviewItem.createMany({ data: [
    { type: "bounce_breaker", stage: 12, reason: "Sending paused: bounces" },
    { type: "proposed_rejection", stage: 3, reason: "beta rule", accountId: betaCo },
  ] });
});

const reasons = async () => (await db.pipelineEvent.findMany({ orderBy: { reason: "asc" } })).map((e) => e.reason);

describe("activity (pipeline steps) is scoped to the client", () => {
  it("a client sees its companies' steps and its own company-less steps, never another client's or platform ones", async () => {
    expect(await withScope({ ids: ["beta"], active: "beta", choices: [], all: false }, reasons)).toEqual(["beta company step", "beta scan: 3 prospects"]);
    expect(await withScope({ ids: ["manch"], active: "manch", choices: [], all: false }, reasons)).toEqual(["manch company step", "manch scan: 12 prospects"]);
  });
  it("a full Super Admin (who covers every client) also sees company-less steps; with every client, everything", async () => {
    expect(await withScope({ ids: ["beta"], active: "beta", choices: [], all: true }, reasons)).toEqual(["beta company step", "beta scan: 3 prospects", "manch scan: 12 prospects", "platform step, no client"]);
    expect(await withScope(null, reasons)).toHaveLength(5);
  });
});

describe("Vega's tools read only the client's records", () => {
  const me = (superAdminClients: string[] | null, superAdmin = true) => ({ superAdmin, superAdminClients, clients: [] });
  it("platform-wide records (the bounce pause) only for a Super Admin covering every client", async () => {
    const items = (ctx: Parameters<typeof toolScope>[0]) => withScope(toolScope(ctx), async () => (await db.reviewItem.findMany()).map((r) => r.type).sort());
    expect(await items({ sellerId: "beta", me: me(null) })).toEqual(["bounce_breaker", "proposed_rejection"]);
    expect(await items({ sellerId: "beta", me: me(["beta"]) })).toEqual(["proposed_rejection"]);
    expect(await items({ sellerId: "beta", me: me([], false) })).toEqual(["proposed_rejection"]);
    expect(await items({ sellerId: "beta", me: null })).toEqual(["proposed_rejection"]);
    expect(await items({ sellerId: "manch", me: me(null) })).toEqual(["bounce_breaker"]);
  });
  it("a query handed back un-awaited still runs inside the scope (no lazy escape)", async () => {
    expect(await withScope({ ids: ["beta"], active: "beta", choices: [], all: false }, () => db.account.findUnique({ where: { id: manchCo } }))).toBeNull();
  });
  it("another client's companies are out of reach whatever the tool asks for", async () => {
    const found = await withScope(toolScope({ sellerId: "beta", me: me(null) }), () => db.account.findUnique({ where: { id: manchCo } }));
    expect(found).toBeNull();
  });
});
