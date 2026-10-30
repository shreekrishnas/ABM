import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseDb } from "@/lib/db-base";

// A signed-in Super Admin, without cookies.
vi.mock("@/lib/me", async (orig) => {
  const real = await orig<typeof import("@/lib/me")>();
  const me = { id: "u1", name: "Admin", email: "admin@trilliantdigital.com", superAdmin: true, canSuperAdmin: true, clients: [] };
  return { ...real, getMe: async () => me, requireSuperAdmin: async () => me };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { clearAccountDataAction, clearWorkspaceDataAction } from "@/app/team/actions";
import { queueHealth, spendByAccount, tablesWithoutAccess } from "@/lib/admin/health";
import { auditCsv } from "@/lib/admin/audit";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const idle = { ok: true, message: "" };

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "acme", name: "Acme" }] });
  const m = await baseDb.account.create({ data: { name: "Manch Co", domain: "manchco.in", sellerId: "manch" } });
  await baseDb.account.create({ data: { name: "Acme Target", domain: "acmetarget.com", sellerId: "acme" } });
  await baseDb.contact.create({ data: { accountId: m.id, fullName: "Ravi M" } });
  await baseDb.ledgerEntry.create({ data: { accountId: m.id, kind: "search", amountMicros: 250_000, description: "search", stage: 5 } });
  await baseDb.prospectSuggestion.create({ data: { sellerId: "manch", name: "Lead", nameKey: "lead", bucket: "other", score: 50, level: "cold", whyNow: "x", sources: [] } });
});

describe("Super Admin: clearing data", () => {
  it("clears one account only after its name is typed, and leaves the others untouched", async () => {
    expect((await clearAccountDataAction("manch", idle, fd({ confirm: "acme" }))).ok).toBe(false);
    expect(await baseDb.account.count()).toBe(2);
    const r = await clearAccountDataAction("manch", idle, fd({ confirm: "manch" }));
    expect(r.ok).toBe(true);
    expect((await baseDb.account.findMany()).map((a) => a.name)).toEqual(["Acme Target"]);
    expect(await baseDb.prospectSuggestion.count()).toBe(0);
    expect(await baseDb.client.count()).toBe(2); // the account itself stays
    expect(await baseDb.auditEntry.findFirst({ where: { action: "data.clear_account" } })).toMatchObject({ clientId: "manch" });
  });

  it("clearing every account needs the phrase typed", async () => {
    expect((await clearWorkspaceDataAction(idle, fd({ confirm: "yes" }))).ok).toBe(false);
    expect(await baseDb.account.count()).toBe(2);
    expect((await clearWorkspaceDataAction(idle, fd({ confirm: "Delete everything" }))).ok).toBe(true);
    expect(await baseDb.account.count()).toBe(0);
  });
});

describe("Super Admin: system health", () => {
  it("lists tables the app can't use", async () => {
    expect(await tablesWithoutAccess()).toEqual([]);
  });

  it("a queue with waiting work and no run for 10 minutes is stuck", async () => {
    await baseDb.account.updateMany({ data: { pipelineStatus: "queued" } });
    expect((await queueHealth()).stuck).toBe(true);
    await baseDb.jobLease.create({ data: { name: "queue", holder: "x", expiresAt: new Date(0), lastRunAt: new Date() } });
    expect((await queueHealth()).stuck).toBe(false);
  });

  it("spend is totalled per account", async () => {
    const s = await spendByAccount();
    expect(s.get("manch")).toMatchObject({ month: 0.25, total: 0.25, companies: 1 });
    expect(s.get("acme")).toBeUndefined();
  });

  it("the audit CSV quotes every cell and neutralises formulas", () => {
    const csv = auditCsv([{ id: "1", actorEmail: "a@x.com", action: "client.add", target: "=HYPERLINK(1)", clientId: "manch", before: null, after: { name: "M" }, createdAt: new Date("2026-10-30T00:00:00Z") }], new Map([["manch", "Manch"]]));
    expect(csv.split("\r\n")[1]).toBe('"2026-10-30T00:00:00.000Z","a@x.com","client.add","added an account","\'=HYPERLINK(1)","Manch","","{""name"":""M""}"');
  });
});
