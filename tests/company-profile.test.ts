// Company profile: financials, funding, technology stack and board — exact parsing, the guards
// against invented values, corroboration, and the run on a real (sample) company.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { newContext } from "@/lib/pipeline/context";
import { amountInQuote, formatAmount, normFiscalYear, parseCurrency, parseUnit, toAbsolute, toUsd } from "@/lib/profile/money";
import { matchTech } from "@/lib/profile/catalog";
import { fingerprintHtml } from "@/lib/profile/website";
import { financialHealth } from "@/lib/profile/health";
import { mapBuiltWith } from "@/lib/profile/builtwith";
import { isOfficialSource, normRound, researchCompanyProfile } from "@/lib/profile/run";
import type { Adapters, ResearchPage } from "@/lib/adapters/types";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function company(domain: string, tier: "T1" | "T2" | "T3" = "T1", employees = 8000) {
  const r = await ingestRows([{ company: domain.split(".")[0], domain, industry: "pharmaceuticals", employees, country: "IN" }], { source: "test" });
  return db.account.update({ where: { id: r.accountIds[0] }, data: { tier } });
}

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

describe("money, units and fiscal years", () => {
  it("reads Indian and international units and currencies", () => {
    expect(parseUnit("Cr")).toBe("crore");
    expect(parseUnit("lakhs")).toBe("lakh");
    expect(parseUnit("bn")).toBe("billion");
    expect(parseUnit("mn")).toBe("million");
    expect(parseCurrency("₹")).toBe("INR");
    expect(parseCurrency("Rs. 4,520 crore")).toBe("INR");
    expect(parseCurrency("US$ 40 million")).toBe("USD");
    expect(parseCurrency("€12m")).toBe("EUR");
    expect(toAbsolute(4520, "crore")).toBe(45_200_000_000);
    expect(toUsd(45_200_000_000, "INR")).toBeCloseTo(542_400_000, -3);
  });

  it("puts every way of writing a fiscal year on one key (the year it ends)", () => {
    for (const s of ["FY2024-25", "FY25", "2024-25", "FY 2025", "year ended March 31, 2025", "FY2024–2025"]) expect(normFiscalYear(s)).toBe("FY2025");
    expect(normFiscalYear("2024")).toBe("FY2024");
    expect(normFiscalYear("last year")).toBeNull();
  });

  it("only accepts a figure that is written in the quote", () => {
    const q = "Revenue from operations rose to ₹4,520.6 crore in FY2024-25.";
    expect(amountInQuote(4520.6, q)).toBe(true);
    expect(amountInQuote(4521, q)).toBe(true); // rounding within 0.5%
    expect(amountInQuote(5420, q)).toBe(false); // transposed digits are a different number
    expect(amountInQuote(4520, "Revenue grew strongly this year.")).toBe(false);
  });

  it("shows rupees in crore and other currencies in M/B", () => {
    expect(formatAmount(45_200_000_000, "INR")).toBe("₹4,520 Cr");
    expect(formatAmount(-1_250_000_000, "USD")).toBe("−$1.3B");
    expect(formatAmount(40_000_000, "USD")).toBe("$40.0M");
  });
});

describe("technology catalog and website detection", () => {
  it("maps product names to one canonical entry, most specific first", () => {
    expect(matchTech("S/4 HANA")?.name).toBe("SAP S/4HANA");
    expect(matchTech("Informatica MDM")?.category).toBe("mdm");
    expect(matchTech("Informatica PowerCenter")?.category).toBe("data_platform");
    expect(matchTech("Salesforce Sales Cloud")?.name).toBe("Salesforce");
    expect(matchTech("Dynamics 365 Finance")?.category).toBe("erp");
    expect(matchTech("a nice tool")).toBeNull();
  });

  it("detects only from markup that loads something, never from visible text", () => {
    const html = `<html><head><script src="//js.hs-scripts.com/123.js"></script><script>(function(){var s=document.createElement('script');s.src='https://munchkin.marketo.net/munchkin.js'})()</script>
      <link rel="stylesheet" href="/wp-content/themes/x/style.css"></head><body><p>We integrate with Salesforce and SAP.</p></body></html>`;
    const found = fingerprintHtml(html, "https://acme.example").map((d) => d.name);
    expect(found).toContain("HubSpot");
    expect(found).toContain("Adobe Marketo Engage");
    expect(found).toContain("WordPress");
    expect(found).not.toContain("Salesforce"); // only mentioned in text
    expect(fingerprintHtml(html, "https://acme.example").find((d) => d.name === "HubSpot")!.detail).toContain("js.hs-scripts.com");
  });

  it("keeps BuiltWith technologies seen in the last year, filed by catalog or tag", () => {
    const now = new Date("2026-10-31");
    const recent = now.getTime() - 30 * 86_400_000;
    const old = now.getTime() - 800 * 86_400_000;
    const out = mapBuiltWith({ Results: [{ Result: { Paths: [{ Technologies: [
      { Name: "Salesforce", Tag: "crm", LastDetected: recent },
      { Name: "Some Analytics Thing", Tag: "analytics", LastDetected: recent },
      { Name: "jQuery", Tag: "javascript", LastDetected: recent },
      { Name: "HubSpot", Tag: "analytics", LastDetected: old },
    ] }] } }] }, now);
    expect(out.map((t) => t.name).sort()).toEqual(["Salesforce", "Some Analytics Thing"]);
    expect(out.find((t) => t.name === "Salesforce")!.category).toBe("crm");
  });
});

describe("financial health and funding rules", () => {
  const row = (fy: string, revenue: number, netProfit: number | null, source = "web") => ({ fiscalYear: fy, currency: "INR", revenue, netProfit, source, status: "probable" });
  it("labels health from margin and growth, preferring filings over web figures", () => {
    expect(financialHealth([row("FY2025", 1100, 110), row("FY2024", 1000, 90)]).label).toBe("profitable_growing");
    expect(financialHealth([row("FY2025", 1000, 100), row("FY2024", 990, 90)]).label).toBe("profitable");
    expect(financialHealth([row("FY2025", 1000, -50)]).label).toBe("loss_making");
    expect(financialHealth([row("FY2025", 1000, 10)]).label).toBe("breakeven");
    expect(financialHealth([row("FY2025", 800, 50), row("FY2024", 1000, 80)]).label).toBe("declining");
    expect(financialHealth([]).label).toBe("unknown");
    // A filing for the same year overrides a web figure that says it lost money.
    expect(financialHealth([row("FY2025", 1000, -50, "web"), row("FY2025", 1000, 80, "filing")]).label).toBe("profitable");
    expect(financialHealth([row("FY2025", 1100, 110), row("FY2024", 1000, 90)]).note).toBe("FY2025 revenue ₹1,100 (+10.0% vs FY2024), net profit ₹110 (10.0% margin)");
  });

  it("normalises round names", () => {
    expect(normRound("Series B")).toBe("series_b");
    expect(normRound("pre-Series A")).toBe("seed");
    expect(normRound("Seed round")).toBe("seed");
    expect(normRound("venture debt")).toBe("debt");
    expect(normRound("strategic round")).toBe("undisclosed");
  });

  it("counts the company's own site, exchanges and regulators as official", () => {
    expect(isOfficialSource("https://investors.acme.in/results", "acme.in")).toBe(true);
    expect(isOfficialSource("https://www.bseindia.com/x.pdf", "acme.in")).toBe(true);
    expect(isOfficialSource("https://news.example.com/acme", "acme.in")).toBe(false);
  });
});

describe("company profile research (sample data)", () => {
  it("stores two fiscal years, corroborates the latest, reads the stack and the board", async () => {
    const a = await company("zentrapharma.in", "T1");
    const sum = await researchCompanyProfile(a, newContext());
    expect(sum.ran.sort()).toEqual(["board", "financials", "funding", "tech_stack"]);

    const fins = await db.companyFinancial.findMany({ where: { accountId: a.id }, orderBy: { fiscalYear: "desc" } });
    expect(fins.map((f) => f.fiscalYear)).toEqual(["FY2025", "FY2024"]);
    // FY2025 is on the company's investor page and in the press: two independent reports.
    expect(fins[0].reports).toBe(2);
    expect(fins[0].status).toBe("verified");
    expect(fins[0].currency).toBe("INR");
    expect(fins[0].revenue! % 1e7).toBe(0); // crore converted to an absolute amount
    expect(fins[0].sourceUrls).toHaveLength(2);

    const acc = await db.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(acc.financialHealth).toBe("profitable_growing");
    expect(acc.financialNote).toMatch(/^FY2025 revenue ₹[\d,]+ Cr \(\+\d+\.\d% vs FY2024\), net profit/);
    expect(Number(acc.revenueUsd)).toBeGreaterThan(0);

    const tech = await db.techUse.findMany({ where: { accountId: a.id } });
    expect(tech.map((t) => t.name).sort()).toEqual(["SAP ECC", "SAP S/4HANA", "Salesforce"]);
    expect(tech.find((t) => t.name === "SAP S/4HANA")!.category).toBe("erp");
    expect(tech.find((t) => t.name === "Salesforce")!.sources).toEqual(["job_post"]);
    expect(acc.technologies).toEqual(expect.arrayContaining(["SAP S/4HANA", "Salesforce"]));

    const board = await db.contact.findMany({ where: { accountId: a.id, discoveredBy: "board_research" } });
    const byName = Object.fromEntries(board.map((c) => [c.fullName, c]));
    expect(byName["Meera Iyer"].stakeholderType).toBe("independent_director");
    expect(byName["Meera Iyer"].buyingRole).toBe("influencer");
    expect(byName["Meera Iyer"].influenceReason).toMatch(/Independent director/);
    expect(byName["Anil Kapoor"].stakeholderType).toBe("adviser");
    expect(byName["Rajiv Menon"].buyingRole).toBe("decision_maker"); // Chairman and Managing Director
  });

  it("skips parts that are still fresh, and T3 gets only financials and technologies", async () => {
    const a = await company("orbiscare.in", "T3");
    const first = await researchCompanyProfile(a, newContext());
    expect(first.ran.sort()).toEqual(["financials", "tech_stack"]);
    const again = await researchCompanyProfile(a, newContext());
    expect(again.ran).toEqual([]);
    expect(again.skipped.map((s) => s.kind).sort()).toEqual(["financials", "tech_stack"]);
  });

  it("drops figures, people and products that are not in the quoted sentence", async () => {
    const a = await company("veritaslabs.in", "T1");
    const page: ResearchPage = { url: "https://news.example.com/veritas", sourceType: "news", publishedAt: new Date(), title: "veritaslabs results", text: "veritaslabs posted revenue of ₹1,200 crore in FY2024-25. Priya Shah is an Independent Director of veritaslabs. veritaslabs uses Oracle NetSuite." };
    const base = createMockAdapters();
    const adapters: Adapters = {
      ...base,
      research: { ...base.research, search: async (_d, _n, _k, _p, hint) => { hint?.onAttempt?.({ engine: "mock", results: 1 }); return [page]; }, engines: () => ["mock"] },
      llm: Object.assign(Object.create(Object.getPrototypeOf(base.llm)), base.llm, {
        extractProfile: async (kind: string) => ({
          financials: [{ page: 0, fiscalYear: "FY2024-25", currency: "INR", unit: "crore", revenue: 2100, netProfit: null, ebitda: null, consolidated: null, quote: "veritaslabs posted revenue of ₹1,200 crore in FY2024-25." }],
          funding: [],
          tech_stack: [{ page: 0, tool: "SAP S/4HANA", context: "uses", quote: "veritaslabs uses Oracle NetSuite." }, { page: 0, tool: "ERP", context: "uses", quote: "veritaslabs uses Oracle NetSuite." }],
          board: [{ page: 0, name: "Ravi Kumar", role: "Independent Director", type: "independent_director", quote: "Priya Shah is an Independent Director of veritaslabs." }],
        })[kind],
      }),
    };
    setAdapters(adapters);
    const sum = await researchCompanyProfile(a, newContext());
    expect(sum.financials + sum.technologies + sum.board).toBe(0);
    expect(sum.dropped).toBe(4);
    expect(await db.companyFinancial.count({ where: { accountId: a.id } })).toBe(0);
    const ev = await db.pipelineEvent.findMany({ where: { accountId: a.id, step: { startsWith: "company_profile." } } });
    expect(JSON.stringify(ev.map((e) => e.data))).toMatch(/figures not in the quoted sentence/);
    expect(JSON.stringify(ev.map((e) => e.data))).toMatch(/a category, not a product/);
  });

  it("never selects board members or advisers for email in the buying group", async () => {
    const a = await company("zentrapharma.in", "T1");
    await researchCompanyProfile(a, newContext());
    const { s08BuyingGroup } = await import("@/lib/pipeline/stages/people");
    await s08BuyingGroup(a, newContext()).catch(() => null);
    const advisers = await db.contact.findMany({ where: { accountId: a.id, stakeholderType: { not: "executive" } } });
    expect(advisers.length).toBeGreaterThan(0);
    expect(advisers.every((c) => c.state === "new")).toBe(true);
  });
});

describe("authentic financial records", () => {
  it("a filed record outranks the web figure for the same year and sets the health reading", async () => {
    const a = await company("filedco.in", "T2");
    await db.companyFinancial.create({ data: { accountId: a.id, fiscalYear: "FY2025", currency: "INR", revenue: 1e10, netProfit: -6e8, source: "web", status: "probable", sourceUrls: ["https://blog.example.com/x"] } });
    const { refreshProfileSummary } = await import("@/lib/profile/run");
    await refreshProfileSummary(a.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).financialHealth).toBe("loss_making");
    await db.companyFinancial.create({ data: { accountId: a.id, fiscalYear: "FY2025", currency: "INR", revenue: 1e10, netProfit: 9e8, source: "filing", status: "verified", publisher: "Audited annual report FY2024-25", addedBy: "analyst@trilliant.test" } });
    await refreshProfileSummary(a.id);
    const acc = await db.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(acc.financialHealth).toBe("profitable");
    expect(acc.financialNote).toBe("FY2025 revenue ₹1,000 Cr, net profit ₹90 Cr (9.0% margin)");
  });
});
