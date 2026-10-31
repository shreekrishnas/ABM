// AI company discovery from a description: criteria drafting and cleaning, the search with hard
// filters, the investigation against the confirmed criteria, and approval.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { newContext } from "@/lib/pipeline/context";
import { buildQueries, cleanCriteria, criteriaProfile, criteriaRules, draftDiscovery, runDiscovery, searchSeed } from "@/lib/discover/describe";
import { processLookalikeQueue } from "@/lib/discover/lookalike";
import { addSuggestion } from "@/lib/discover/scan";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

describe("criteria", () => {
  it("cleans what the AI or the form gives: ISO countries, ordered size range, capped lists, enough queries", () => {
    const c = cleanCriteria({ industries: ["pharma", "pharma", " "], countries: ["India", "uae", "Atlantis"], minEmployees: "20,000", maxEmployees: 5000, queries: ["one query"] }, "brief");
    expect(c.industries).toEqual(["pharma"]);
    expect(c.countries).toEqual(["IN", "AE"]);
    expect([c.minEmployees, c.maxEmployees]).toEqual([5000, 20000]);
    expect(c.summary).toBe("brief");
    expect(c.queries.length).toBeGreaterThanOrEqual(2);
    expect(c.queries[0]).toBe("one query");
    expect(c.funding).toBeNull();
  });

  it("builds searches from the criteria when the AI gives none", () => {
    const q = buildQueries({ summary: "s", industries: ["pharmaceuticals"], countries: ["IN"], minEmployees: 5000, maxEmployees: null, businessModels: [], mustHave: [], niceToHave: [], exclude: [], technologies: ["SAP S/4HANA"], funding: null, signals: ["ERP migration"] });
    expect(q).toEqual(["leading pharmaceuticals companies India 5,000+ employees", "pharmaceuticals ERP migration India", "pharmaceuticals using SAP S/4HANA India"]);
  });

  it("turns confirmed criteria into the reference profile and rules the investigation checks", () => {
    const c = cleanCriteria({ summary: "Indian pharma moving to S/4HANA", industries: ["pharma"], countries: ["IN"], minEmployees: 5000, technologies: ["SAP S/4HANA"], mustHave: ["owns manufacturing plants"], exclude: ["contract research only"], funding: { stages: ["Series B"], withinMonths: 24 } }, "x");
    const p = criteriaProfile(c);
    expect(p.scale).toBe("5,000+ employees in India");
    expect(p.operations).toBe("owns manufacturing plants; uses SAP S/4HANA");
    expect(criteriaRules(c)).toEqual({ focus: ["owns manufacturing plants", "uses SAP S/4HANA", "raised Series B within the last 24 months"], avoid: ["contract research only"] });
  });
});

describe("search and investigation", () => {
  it("drafts criteria, searches, applies the size floor, queues candidates and investigates them against the criteria", async () => {
    const s = await draftDiscovery("Indian pharma companies with 5,000+ employees moving to SAP S/4HANA", "analyst@trilliant.test", newContext());
    const c = s.criteria as unknown as ReturnType<typeof cleanCriteria>;
    expect(s.status).toBe("draft");
    expect(c.industries).toEqual(["pharma"]);
    expect(c.countries).toEqual(["IN"]);
    expect(c.minEmployees).toBe(5000);
    expect(c.technologies).toEqual(["sap s/4hana"]);
    expect(c.queries.length).toBeGreaterThanOrEqual(2);

    const r = await runDiscovery(s.id, newContext());
    // Six sample pharma companies are named; Godavari Generics (3,100 staff) is below the floor.
    expect(r.found).toBe(6);
    expect(r.skipped.find((x) => x.name === "Godavari Generics")?.reason).toBe("3,100 employees, below 5,000");
    const sugg = await db.prospectSuggestion.findMany({ where: { origin: "discovery", seed: searchSeed(s.id) } });
    expect(sugg.map((x) => x.name).sort()).toEqual(["Kaveri Biologics", "Narmada Pharma", "Sahyadri Lifesciences", "Tapti Remedies", "Vindhya Healthcare"]);
    expect(sugg.every((x) => x.researchStatus === "queued" && x.requestedBy === "analyst@trilliant.test")).toBe(true);
    const saved = await db.discoverySearch.findUniqueOrThrow({ where: { id: s.id } });
    expect(saved.status).toBe("done");
    expect(saved.candidates).toBe(5);

    await processLookalikeQueue({ budgetMs: 60_000, ctx: newContext() });
    const done = await db.prospectSuggestion.findMany({ where: { origin: "discovery" } });
    expect(done.every((x) => x.researchStatus === "done")).toBe(true);
    expect(done.every((x) => x.fitScore != null && x.readiness)).toBe(true);
    expect(done.some((x) => x.whyNow.startsWith("Matches your search"))).toBe(true);
  });

  it("drops companies outside the stated countries, and never repeats one already held", async () => {
    const s = await draftDiscovery("FMCG companies in India that sell through distributors", null, newContext());
    const r = await runDiscovery(s.id, newContext());
    expect(r.skipped.find((x) => x.name === "Marina Retail Group")?.reason).toBe("based in SG, not IN");
    const before = await db.prospectSuggestion.count();
    const again = await draftDiscovery("FMCG companies in India that sell through distributors", null, newContext());
    const r2 = await runDiscovery(again.id, newContext());
    // Lotus and Saffron are already suggested: skipped, not re-queued or moved. Marina is filtered by country again.
    expect(r2.skipped.filter((x) => x.reason === "already suggested").map((x) => x.name).sort()).toEqual(["Lotus Consumer Brands", "Saffron Foods"]);
    expect(r2.found).toBe(1);
    expect(r2.queued).toBe(0);
    expect(await db.prospectSuggestion.count()).toBe(before);
  });

  it("an approved company enters the pipeline as a discovery, only after its investigation", async () => {
    const s = await draftDiscovery("Indian pharma companies with 5,000+ employees", null, newContext());
    await runDiscovery(s.id, newContext());
    const one = await db.prospectSuggestion.findFirstOrThrow({ where: { origin: "discovery" } });
    expect(await addSuggestion(one.id, "lead@trilliant.test")).toBeNull(); // still being researched
    await processLookalikeQueue({ budgetMs: 60_000, ctx: newContext() });
    const accountId = await addSuggestion(one.id, "lead@trilliant.test");
    const acc = await db.account.findUniqueOrThrow({ where: { id: accountId! } });
    expect(acc.source).toBe("discovery");
  });
});
