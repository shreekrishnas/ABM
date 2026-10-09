import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { MANCH } from "@/lib/seller/manch";
import { addSuggestion, dismissSuggestion, maybeScanMarket, scanMarket } from "@/lib/discover/scan";
import { industryTrends, momentumOf } from "@/lib/discover/trends";
import { newContext } from "@/lib/pipeline/context";

let saved: typeof MANCH.icp.mustHave;
beforeAll(() => {
  saved = MANCH.icp.mustHave;
  MANCH.icp.mustHave = { countries: ["IN"], minEmployees: 5001 };
});
afterAll(() => {
  MANCH.icp.mustHave = saved;
});
beforeEach(async () => {
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

describe("Discover: market scan", () => {
  it("suggests new Indian companies over 5,000 employees, with quotes and an intent score", async () => {
    const r = await scanMarket(newContext());
    expect(r.events).toBeGreaterThan(0);
    const all = await db.prospectSuggestion.findMany();
    const by = (n: string) => all.find((s) => s.name === n)!;
    expect(by("Sahyadri Lifesciences").status).toBe("new");
    expect(by("Sahyadri Lifesciences").country).toBe("IN");
    expect(by("Sahyadri Lifesciences").employees).toBe(18000);
    expect(by("Sahyadri Lifesciences").whyNow).toMatch(/S\/4HANA/);
    expect((by("Sahyadri Lifesciences").sources as { quote: string }[])[0].quote).toMatch(/Sahyadri/);
    // Outside the targeting rule: Singapore, and fewer than 5,001 employees.
    expect(by("Marina Retail Group").status).toBe("excluded");
    expect(by("Marina Retail Group").reason).toMatch(/Outside target countries/);
    expect(by("Godavari Generics").status).toBe("excluded");
    expect(by("Godavari Generics").reason).toMatch(/Too small/);
  });

  it("skips companies already in the database", async () => {
    await ingestRows([{ "Company Name": "Narmada Pharma", "Company Website": "narmadapharma.in" }], { source: "csv" });
    await scanMarket(newContext());
    expect(await db.prospectSuggestion.count({ where: { name: "Narmada Pharma" } })).toBe(0);
  });

  it("add queues the company; dismiss keeps it out of later scans", async () => {
    await scanMarket(newContext());
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Sahyadri Lifesciences" } });
    const accountId = await addSuggestion(s.id);
    const acc = await db.account.findUniqueOrThrow({ where: { id: accountId! } });
    expect(acc.name).toBe("Sahyadri Lifesciences");
    expect(acc.source).toBe("discover");
    expect(acc.pipelineStatus).toBe("queued");
    const d = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Saffron Foods" } });
    await dismissSuggestion(d.id);
    await scanMarket(newContext());
    expect((await db.prospectSuggestion.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("dismissed");
    expect((await db.prospectSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("added");
  });

  it("runs from the tick at most once a week", async () => {
    expect(await maybeScanMarket(newContext())).toBe(true);
    expect(await maybeScanMarket(newContext())).toBe(false);
  });
});

describe("Discover: industry radar", () => {
  it("momentum rules", () => {
    expect(momentumOf(5, 0.5)).toBe("rising");
    expect(momentumOf(1, 2)).toBe("cooling");
    expect(momentumOf(2, 2)).toBe("steady");
    expect(momentumOf(0, 0)).toBe("quiet");
  });

  it("catches pharma rising and under-covered; FMCG cooling", async () => {
    await scanMarket(newContext());
    const t = await industryTrends();
    const pharma = t.find((x) => x.key === "pharma")!;
    expect(pharma.momentum).toBe("rising");
    expect(pharma.underCovered).toBe(true);
    expect(pharma.narrative).toMatch(/You hold no companies here.*add companies/);
    expect(t[0].key).toBe("pharma");
    expect(t.find((x) => x.key === "fmcg")!.momentum).not.toBe("rising");
  });
});
