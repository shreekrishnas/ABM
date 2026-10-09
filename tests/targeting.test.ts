import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { mustHaveGate } from "@/lib/pipeline/gates";
import { MANCH } from "@/lib/seller/manch";

// Manch's real rule, as configured in the seller pack.
const RULE = { countries: ["IN"], minEmployees: 5001 };
let saved: typeof MANCH.icp.mustHave;
let savedEmp: typeof MANCH.icp.employees;
beforeAll(() => {
  saved = MANCH.icp.mustHave;
  savedEmp = MANCH.icp.employees;
  MANCH.icp.mustHave = RULE;
  MANCH.icp.industryMode = "any";
  MANCH.icp.employees = { sweetSpot: 10000, mid: 5001, min: 5001 };
});
afterAll(() => {
  MANCH.icp.mustHave = saved;
  MANCH.icp.industryMode = "targeted";
  MANCH.icp.employees = savedEmp;
});
beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
});

const add = async (name: string, extra: Record<string, unknown>) => (await ingestRows([{ "Company Name": name, "Company Website": `strong-${name.toLowerCase().replace(/\s+/g, "")}.com`, Industry: "fmcg", "First Name": "Asha", "Job Title": "Head of Master Data", ...extra }], { source: "csv" })).accountIds[0];

describe("Manch targeting: India and more than 5,000 employees", () => {
  it("any industry qualifies: a cement maker and a bank score the same fit", async () => {
    const { scoreFit } = await import("@/lib/pipeline/scoring");
    const a = scoreFit({ industry: "cement", employees: 12000, country: "IN", technologies: [] });
    const b = scoreFit({ industry: "software services", employees: 12000, country: "IN", technologies: [] });
    expect(a.fit).toBe(b.fit);
    expect(a.components.find((c) => c.key === "industry")?.points).toBeNull();
  });

  it("the rule itself", () => {
    expect(mustHaveGate({ country: "IN", employees: 6000 }, RULE).pass).toBe(true);
    expect(mustHaveGate({ country: "IN", employees: 5000 }, RULE).reason).toMatch(/Too small/);
    expect(mustHaveGate({ country: "AE", employees: 9000 }, RULE).reason).toMatch(/Outside target countries/);
    expect(mustHaveGate({ country: null, employees: 9000 }, RULE)).toMatchObject({ pass: false, unknown: true });
  });

  it("an Indian company with 6,500 employees is researched", async () => {
    const id = await add("Big India Foods", { "Employee Size": "6500", Country: "India" });
    await runAccount(id);
    expect(await db.evidence.count({ where: { accountId: id } })).toBeGreaterThan(0);
  });

  it("too small or outside India is excluded before any research spend", async () => {
    const small = await add("Small India Foods", { "Employee Size": "3000", Country: "IN" });
    const abroad = await add("Gulf Foods", { "Employee Size": "9000", Country: "AE" });
    await runAccount(small);
    await runAccount(abroad);
    for (const id of [small, abroad]) {
      const a = await db.account.findUniqueOrThrow({ where: { id } });
      expect(a.stage).toBe("DISQUALIFIED");
      expect(await db.researchQuery.count({ where: { accountId: id, key: { notIn: ["website", "firmographics"] } } })).toBe(0);
    }
  });

  it("unknown size waits for data, then runs when a re-upload adds it", async () => {
    const id = await add("Mystery Foods", { Country: "IN" });
    await db.account.update({ where: { id }, data: { employees: null } });
    const r1 = await runAccount(id, { fromStage: 3 });
    expect(r1.status).toBe("blocked");
    expect((await db.account.findUniqueOrThrow({ where: { id } })).stage).not.toBe("DISQUALIFIED");
    await db.account.update({ where: { id }, data: { employees: 8000 } });
    const r2 = await runAccount(id, { fromStage: 3 });
    expect(r2.status).not.toBe("blocked");
    expect((await db.account.findUniqueOrThrow({ where: { id } })).disqualifyReason).toBeNull();
  });
});
