// Website visitors: employees, annual revenue and industry come from what Apollo already returns while the
// visitors are pulled (the visitor list and its company search), saved per client and company, and shown on
// the page when the company has no record or enrichment of its own. No extra Apollo request is made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apollo = vi.hoisted(() => ({ companies: vi.fn(), dates: vi.fn() }));
vi.mock("@/lib/adapters/live/apollo", async (orig) => ({
  ...(await orig<typeof import("@/lib/adapters/live/apollo")>()),
  apolloVisitorCompanies: apollo.companies,
  apolloVisitDates: apollo.dates,
}));
vi.mock("@/lib/discover/visitors", () => ({ suggestFromVisitors: vi.fn(async () => ({ suggested: 0, excluded: 0, justVisitors: 0 })) }));

import { baseDb } from "@/lib/db-base";
import { clearSellerOverrides, ensureSellerPacks, withSeller } from "@/lib/seller";
import { visitorFacts, type VisitorFacts } from "@/lib/adapters/live/apollo";
import { dailyVisitorPull, syncApolloVisitors } from "@/lib/web/apollo-sync";
import { companyFacts, companyKey } from "@/lib/web/visitor-prospects";
import { newContext } from "@/lib/pipeline/context";

const mode = process.env.ADAPTER_MODE;
const outside = vi.fn(async () => { throw new Error("no outside requests in this test"); });
const SITE_DATE = { at: new Date("2026-11-22T09:00:00Z"), field: "domain_aggregates.last_visit (manchtech.com)" };

function list() {
  return Object.assign([
    // Apollo's account carries the numbers on its nested organization.
    { name: "Acme Steel", domain: "acmesteel.example", lastSeenAt: null, dateField: null, facts: visitorFacts({ organization: { estimated_num_employees: 1200, annual_revenue: 85_000_000, industry: "Steel" } }) },
    // The list has nothing; the company search fills it.
    { name: "Bharat Foods", domain: "bharatfoods.example", lastSeenAt: null, dateField: null, facts: null },
    // Nothing anywhere: stays empty.
    { name: "Quiet Co", domain: "quiet.example", lastSeenAt: null, dateField: null, facts: null },
  ], { totalPages: 1, truncated: false });
}

beforeEach(async () => {
  const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  clearSellerOverrides();
  delete process.env.APOLLO_VISITOR_SITE;
  process.env.APOLLO_API_KEY = "test-key";
  delete process.env.ADAPTER_MODE;
  vi.stubGlobal("fetch", outside);
  outside.mockClear();
  apollo.companies.mockReset().mockImplementation(async () => list());
  apollo.dates.mockReset().mockImplementation(async (_k: string, _d: string[], _s: string | null, facts?: Map<string, VisitorFacts>) => {
    facts?.set("bharatfoods.example", { employees: 340, revenueUsd: 12_500_000, industry: "Food" });
    facts?.set("acmesteel.example", { employees: 999, revenueUsd: null, industry: null }); // the list's own figure wins
    return new Map([["acmesteel.example", SITE_DATE], ["bharatfoods.example", SITE_DATE], ["quiet.example", SITE_DATE]]);
  });
  await baseDb.client.createMany({ data: [{ id: "manch", name: "Manch" }, { id: "beta", name: "Beta" }] });
  await ensureSellerPacks(true);
});
afterEach(() => {
  if (mode === undefined) delete process.env.ADAPTER_MODE; else process.env.ADAPTER_MODE = mode;
  delete process.env.APOLLO_API_KEY;
  vi.unstubAllGlobals();
  clearSellerOverrides();
});

describe("company facts from the website-visitor pull", () => {
  it("reads employees, revenue and industry from an Apollo company or its nested organization", () => {
    expect(visitorFacts({ estimated_num_employees: 50, annual_revenue: 2_000_000, industry: "Software" })).toEqual({ employees: 50, revenueUsd: 2_000_000, industry: "Software" });
    expect(visitorFacts({ organization: { estimated_num_employees: "1,200", organization_revenue: 7e6 } })).toEqual({ employees: 1200, revenueUsd: 7e6, industry: null });
    expect(visitorFacts({ name: "Nothing", estimated_num_employees: 0, annual_revenue: null })).toBeNull();
  });

  it("the daily pull saves them for the list owner, from the list first and the company search second", async () => {
    const r = await dailyVisitorPull(newContext());
    expect(r).toMatchObject({ client: "manch", recorded: 3 });
    const rows = await baseDb.visitorCompanyFacts.findMany({ orderBy: { companyName: "asc" } });
    expect(rows.map((f) => [f.sellerId, f.companyKey, f.employees, f.revenueUsd, f.industry])).toEqual([
      ["manch", "d:acmesteel.example", 1200, 85_000_000, "Steel"],
      ["manch", "d:bharatfoods.example", 340, 12_500_000, "Food"],
    ]);
    const ev = await baseDb.pipelineEvent.findFirstOrThrow({ where: { step: "apollo.visitors", outcome: "info" } });
    expect(ev.data).toMatchObject({ factsSaved: 2 });
    expect(apollo.dates).toHaveBeenCalledTimes(1); // the existing company search, nothing extra
    expect(outside).not.toHaveBeenCalled();
  });

  it("a later pull without a figure keeps the one saved before", async () => {
    await dailyVisitorPull(newContext());
    apollo.companies.mockImplementation(async () => Object.assign([{ name: "Acme Steel", domain: "acmesteel.example", lastSeenAt: null, dateField: null, facts: visitorFacts({ industry: "Steel" }) }], { totalPages: 1, truncated: false }));
    apollo.dates.mockImplementation(async () => new Map([["acmesteel.example", SITE_DATE]]));
    await withSeller("manch", () => syncApolloVisitors(newContext(), { force: true }));
    const acme = await baseDb.visitorCompanyFacts.findUniqueOrThrow({ where: { sellerId_companyKey: { sellerId: "manch", companyKey: "d:acmesteel.example" } } });
    expect([acme.employees, acme.revenueUsd]).toEqual([1200, 85_000_000]);
  });

  it("the page shows them when the company has no record or enrichment, and nothing when Apollo sent none", async () => {
    await dailyVisitorPull(newContext());
    const f = await baseDb.visitorCompanyFacts.findUniqueOrThrow({ where: { sellerId_companyKey: { sellerId: "manch", companyKey: companyKey("Acme Steel", "acmesteel.example") } } });
    const shown = await companyFacts({ enrichment: null, facts: { employees: f.employees, revenueUsd: f.revenueUsd, industry: f.industry, updatedAt: f.updatedAt } }, null);
    expect(shown.employees).toEqual({ value: "1,200", source: "Apollo (visitor list)" });
    expect(shown.revenue).toMatchObject({ amount: 85_000_000, currency: "USD", source: "Apollo (visitor list)" });
    const none = await companyFacts({ enrichment: null, facts: null }, null);
    expect(none).toEqual({ revenue: null, employees: null });
  });

  it("nothing is saved for another client", async () => {
    await dailyVisitorPull(newContext());
    expect(await baseDb.visitorCompanyFacts.count({ where: { sellerId: { not: "manch" } } })).toBe(0);
  });
});
