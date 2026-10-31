// Advanced fit: partner network, business model, solution relevance, financial capacity and
// likeness to won customers — each scored only once research has established it.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { sellerFit } from "@/lib/seller/fit";
import { MANCH } from "@/lib/seller/manch";
import { fitResearchFor, rescoreFit, similarity } from "@/lib/pipeline/fit-research";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}
async function company(domain: string, industry = "fmcg", employees = 1500, country = "IN", technologies: string[] = []) {
  const r = await ingestRows([{ company: domain.split(".")[0], domain, industry, employees, country, technologies: technologies.join(";") }], { source: "test" });
  return db.account.findUniqueOrThrow({ where: { id: r.accountIds[0] } });
}

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

const firmo = { industry: "fmcg", employees: 1500, country: "IN", technologies: ["SAP S/4HANA"] };

describe("fit components from research", () => {
  it("before research, the new components are unknown: same score as firmographics alone, same coverage", () => {
    const before = sellerFit(firmo, MANCH);
    const after = sellerFit({ ...firmo, research: {} }, MANCH);
    expect(after.fit).toBe(before.fit);
    expect(after.coverage).toBe(before.coverage);
    expect(after.components.filter((c) => c.points === null).map((c) => c.key)).toEqual(expect.arrayContaining(["partnerNetwork", "businessModel", "solutionRelevance", "financialCapacity", "customerLikeness"]));
  });

  it("scores each research component by its fixed rule", () => {
    const f = sellerFit({ ...firmo, research: { partnerNetwork: 12000, businessModel: "distributor_network", solutionClass: "supported_opportunity", solutionUseCase: "vendor_onboarding", financialHealth: "profitable_growing", recentFunding: false, winSimilarity: null, wins: { have: 2, needed: 5 } } }, MANCH);
    const c = Object.fromEntries(f.components.map((x) => [x.key, x]));
    expect([c.partnerNetwork.points, c.partnerNetwork.max]).toEqual([15, 15]);
    expect(c.partnerNetwork.reason).toBe("About 12,000 partners — large network");
    expect([c.businessModel.points, c.businessModel.max]).toEqual([15, 15]);
    expect([c.solutionRelevance.points, c.solutionRelevance.max]).toEqual([17, 20]); // 85%
    expect(c.solutionRelevance.reason).toBe("Several connected facts support a specific need (Vendor & supplier onboarding)");
    expect([c.financialCapacity.points, c.financialCapacity.max]).toEqual([10, 10]);
    expect(c.customerLikeness.points).toBeNull();
    expect(c.customerLikeness.reason).toBe("Needs 5 won deals to compare (have 2)");
  });

  it("a weak case scores low, and an 'irrelevant' verdict pulls fit down", () => {
    const strong = sellerFit({ ...firmo, research: { solutionClass: "direct_intent", financialHealth: "profitable" } }, MANCH).fit!;
    const none = sellerFit({ ...firmo, research: { solutionClass: "irrelevant", financialHealth: "loss_making" } }, MANCH).fit!;
    expect(strong).toBeGreaterThan(none + 20);
    const funded = sellerFit({ ...firmo, research: { financialHealth: "loss_making", recentFunding: true } }, MANCH).components.find((c) => c.key === "financialCapacity")!;
    expect(funded.points).toBe(7); // loss-making but funded in the last 24 months
  });

  it("partner network bands and non-target business models", () => {
    const pts = (n: number) => sellerFit({ ...firmo, research: { partnerNetwork: n } }, MANCH).components.find((c) => c.key === "partnerNetwork")!.points;
    expect([pts(6000), pts(1500), pts(300), pts(50)]).toEqual([15, 11, 5, 2]);
    const bm = sellerFit({ ...firmo, research: { businessModel: "d2c" } }, MANCH).components.find((c) => c.key === "businessModel")!;
    expect(bm.points).toBe(2);
    expect(bm.reason).toBe("d2c — not a target model");
  });
});

describe("likeness to won customers", () => {
  it("compares traits both companies have", () => {
    const t = (o: Partial<{ industry: string; size: number; geo: string; tech: string[]; model: string }>) => ({ industry: o.industry ?? null, size: o.size ?? null, geo: o.geo ?? null, tech: new Set(o.tech ?? []), model: o.model ?? null });
    expect(similarity(t({ industry: "fmcg", size: 3, geo: "home" }), t({ industry: "fmcg", size: 2, geo: "home" })).score).toBeCloseTo((1 + 0.5 + 1) / 3);
    expect(similarity(t({ industry: "fmcg" }), t({ industry: "fmcg" })).score).toBe(0); // one shared trait is not enough
    expect(similarity(t({ industry: "fmcg", tech: ["erp", "crm"] }), t({ industry: "pharma", tech: ["erp"] })).matched).toEqual(["systems"]);
  });

  it("is scored once five won deals exist, from the three closest", async () => {
    for (let i = 0; i < 5; i++) {
      const w = await company(`won${i}.in`, i < 3 ? "fmcg" : "banking", i < 3 ? 1600 : 300, "IN", i < 3 ? ["SAP S/4HANA"] : ["Salesforce"]);
      await db.opportunity.create({ data: { accountId: w.id, name: `Deal ${i}`, stage: "won", amountUsd: 10000 } });
    }
    const a = await company("candidate.in", "fmcg", 1700, "IN", ["SAP ECC"]);
    const r = await fitResearchFor(a);
    expect(r.wins).toEqual({ have: 5, needed: 5 });
    expect(r.winSimilarity!.score).toBe(1); // same industry, size band, market and ERP category as the 3 fmcg wins
    expect(r.winSimilarity!.matched).toEqual(["industry", "size", "market", "systems"]);
  });
});

describe("re-scoring with research", () => {
  it("reads partner network, conclusions and finances from the database and explains the change", async () => {
    const a = await company("deepfit.in");
    await db.evidence.create({ data: { accountId: a.id, key: "partner_network", claim: "deepfit works with 8,000 distributors", value: "8000", sourceUrl: "https://x.example/1", sourceType: "news", publishedAt: new Date(), status: "verified" } });
    await db.evidence.create({ data: { accountId: a.id, key: "business_model", claim: "deepfit sells through distributors and retailers", value: "distributor_network", sourceUrl: "https://x.example/2", sourceType: "news", publishedAt: new Date(), status: "probable" } });
    await db.hypothesis.create({ data: { accountId: a.id, text: "Distributor growth creates onboarding load", classification: "supported_opportunity", status: "validated", useCase: "distributor_onboarding" } });
    await db.account.update({ where: { id: a.id }, data: { financialHealth: "profitable" } });
    const before = a.fitScore;
    const after = await rescoreFit(await db.account.findUniqueOrThrow({ where: { id: a.id } }));
    expect(after.businessModel).toBe("distributor_network");
    expect(after.fitReasons.find((r) => r.startsWith("Partner network"))).toBe("Partner network: 15/15 — About 8,000 partners — large network");
    expect(after.fitReasons.find((r) => r.startsWith("Solution relevance"))).toBe("Solution relevance: 17/20 — Several connected facts support a specific need (Distributor & retailer lifecycle)");
    expect(after.fitReasons.find((r) => r.startsWith("Financial capacity"))).toBe("Financial capacity: 9/10 — Profitable");
    expect(after.fitScore).not.toBe(before);
  });
});
