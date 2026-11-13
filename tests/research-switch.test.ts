// Live research is switched on per client. Off: nothing is searched and queued work waits untouched.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { withSeller, SELLERS } from "@/lib/seller";
import { MANCH } from "@/lib/seller/manch";
import { ResearchOff, assertResearchAllowed, researchAllowed, researchOnIds, setResearchAllowed } from "@/lib/admin/research-clients";
import { WebResearch } from "@/lib/adapters/live/research";
import { processQueue } from "@/lib/pipeline/orchestrator";

beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await setResearchAllowed("manch", true, "test"); // also clears the switch cache between tests
  await baseDb.integrationSetting.deleteMany({ where: { key: { startsWith: "research:" } } });
  await setResearchAllowed("acme", false, "test");
});

describe("the switch", () => {
  it("Manch is on by default; other clients are off; the Test client is never on", async () => {
    expect(await researchAllowed("manch")).toBe(true);
    expect(await researchAllowed("acme")).toBe(false);
    await setResearchAllowed("test", true, "test");
    expect(await researchAllowed("test")).toBe(false);
    expect(await researchOnIds()).not.toContain("test");
  });
  it("switching a client on and off takes effect at once", async () => {
    await setResearchAllowed("acme", true, "test");
    expect(await researchAllowed("acme")).toBe(true);
    await setResearchAllowed("acme", false, "test");
    expect(await researchAllowed("acme")).toBe(false);
  });
});

describe("real search refuses for clients that are off", () => {
  it("throws before any network call", async () => {
    SELLERS.acme = { ...MANCH, id: "acme", name: "Acme" };
    try {
      await expect(withSeller("acme", () => assertResearchAllowed())).rejects.toBeInstanceOf(ResearchOff);
      const w = new WebResearch({ exa: "dummy-key-never-used" });
      await expect(withSeller("acme", () => w.search("example.com", `Example ${Date.now()}`, "trigger", "main"))).rejects.toBeInstanceOf(ResearchOff);
    } finally {
      delete SELLERS.acme;
    }
  });
});

describe("the queue", () => {
  it("works only on clients with research on; the others stay queued and untouched", async () => {
    const on = await baseDb.account.create({ data: { name: "On Co", domain: "onco.in", sellerId: "manch", pipelineStatus: "queued", queuedFromStage: 2, country: "IN", employees: 800, industry: "fmcg" } });
    const off = await baseDb.account.create({ data: { name: "Off Co", domain: "offco.in", sellerId: "acme", pipelineStatus: "queued", queuedFromStage: 2 } });
    await processQueue({ budgetMs: 60_000 });
    expect((await baseDb.account.findUniqueOrThrow({ where: { id: on.id } })).pipelineStatus).not.toBe("queued");
    const after = await baseDb.account.findUniqueOrThrow({ where: { id: off.id } });
    expect(after.pipelineStatus).toBe("queued");
    expect(after.updatedAt.getTime()).toBe(off.updatedAt.getTime());
    expect(await baseDb.pipelineEvent.count({ where: { accountId: off.id } })).toBe(0);
  });
});
