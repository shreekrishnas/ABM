// The platform is seller-neutral: a completely different seller pack (an HR software company
// selling in Germany) runs through the same flow, and nothing of the first seller leaks in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { SELLERS, clearSellerOverrides, withSeller } from "@/lib/seller";
import { validatePack } from "@/lib/seller/schema";
import { MANCH } from "@/lib/seller/manch";
import type { SellerProfile } from "@/lib/seller/types";
import { pickUseCase } from "@/lib/seller/fit";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { targetCountries } from "@/lib/discover/scan";
import { titlesFor } from "@/lib/adapters/live/apollo";
import { topicOf } from "@/lib/web/visits";

const ACME: SellerProfile = {
  ...structuredClone(MANCH),
  id: "acme",
  name: "Acme People",
  website: "https://acme-people.example",
  hq: "Berlin, Germany",
  summary: "HR and payroll software for mid-size employers.",
  positioning: "Payroll and onboarding for employees in one place.",
  products: [{ name: "Acme Payroll", what: "Payroll for multi-country teams" }] as SellerProfile["products"],
  useCases: [
    { key: "payroll_consolidation", name: "Payroll consolidation", pains: "Several payroll vendors across countries", outcome: "One payroll run" },
    { key: "employee_onboarding", name: "Employee onboarding", pains: "Paper onboarding for new hires", outcome: "New hires ready on day one" },
  ],
  proofPoints: [{ text: "Payroll run time cut from five days to one", source: "acme-people.example" }],
  customers: [],
  competitors: [{ name: "Personio", category: "hris", angle: "We focus on payroll accuracy across countries" }],
  icp: {
    ...structuredClone(MANCH.icp),
    industries: [
      { key: "retail", label: "Retail", tier: "primary", match: ["retail", "stores"], partnerIntensity: 0.2, useCases: ["employee_onboarding"] },
      { key: "logistics", label: "Logistics", tier: "primary", match: ["logistics", "transport"], partnerIntensity: 0.2, useCases: ["payroll_consolidation", "employee_onboarding"] },
    ],
    employees: { sweetSpot: 2000, mid: 1000, min: 500 },
    geos: { primary: ["DE"], secondary: ["AT", "CH"] },
    mustHave: { countries: ["DE"], minEmployees: 500 },
    industryMode: "targeted",
    tierBySize: { T1: 5000, T2: 1500 },
  },
  personas: [
    { role: "decision_maker", functions: ["hr"], titles: ["chief people officer", "head of hr", "hr director"], why: "Owns HR systems" },
    { role: "budget_owner", functions: ["finance"], titles: ["cfo", "head of payroll"], why: "Pays for payroll" },
  ] as SellerProfile["personas"],
  triggers: [
    { key: "hiring_surge", label: "Hiring surge", keywords: ["hiring", "new employees", "headcount"], why: "Onboarding volume grows", useCase: "employee_onboarding", family: "hiring" },
    { key: "expansion_abroad", label: "Expansion to new countries", keywords: ["expansion", "new market", "opens office", "acquisition"], why: "Payroll in more countries", useCase: "payroll_consolidation" },
  ],
  researchQuestions: MANCH.researchQuestions.filter((q) => ["trigger", "owner_function", "negative"].includes(q.key)).map((q) => ({ ...q, search: q.key === "trigger" ? { terms: "(hiring OR expansion OR acquisition)", days: 120, news: true } : q.search, extract: undefined })),
  messaging: { cta: "Worth a short call?", byUseCase: { payroll_consolidation: "Running payroll in several countries usually means several vendors.", employee_onboarding: "Hiring at that pace usually strains onboarding." }, default: "Acme People runs payroll and onboarding in one place." },
  sender: { company: "Acme People GmbH", name: "Team Acme", address: "Friedrichstraße 1, 10117 Berlin, Germany" },
  bannedClaims: ["guaranteed savings"],
  writing: undefined,
};

beforeAll(async () => {
  SELLERS.acme = ACME;
  setAdapters(createMockAdapters());
  clearSellerOverrides();
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@acme-people.example", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead with the trigger" }] } } });
});
afterAll(() => {
  delete SELLERS.acme;
});

describe("a second, unrelated seller uses the same platform", () => {
  it("its pack is valid", () => {
    expect(validatePack(ACME)).toEqual([]);
  });

  it("everything seller-specific comes from its pack", async () => {
    await withSeller("acme", async () => {
      expect(targetCountries()).toBe("Germany");
      expect(titlesFor("hr")).toContain("head of hr");
      expect(pickUseCase("logistics", "hiring_surge", ACME)).toBe("employee_onboarding");
      expect(topicOf("https://acme-people.example/blog/hiring-new-employees").key).toBe("hiring_surge");
    });
  });

  it("runs import → targeting → research → drafts with its own name, rule and use cases", async () => {
    const r = await ingestRows([
      { "Company Name": "Rhein Logistik", "Company Website": "strong-rheinlogistik.de", Industry: "logistics", "Employee Size": "2400", Country: "Germany", "First Name": "Jana", "Last Name": "Weber", "Job Title": "Head of HR", Email: "jana.weber@strong-rheinlogistik.de" },
      { "Company Name": "Mumbai Movers", "Company Website": "strong-mumbaimovers.in", Industry: "logistics", "Employee Size": "9000", Country: "India" },
    ], { source: "csv" });
    await db.account.updateMany({ where: { id: { in: r.accountIds } }, data: { sellerId: "acme" } });
    for (const id of r.accountIds) await runAccount(id);

    const india = await db.account.findFirstOrThrow({ where: { domain: "strong-mumbaimovers.in" } });
    expect(india.disqualifyReason).toMatch(/Outside target countries .*DE/);

    const de = await db.account.findFirstOrThrow({ where: { domain: "strong-rheinlogistik.de" } });
    expect(de.tier).toBe("T2"); // 2,400 employees under Acme's size tiers
    const drafts = await db.draft.findMany({ where: { contact: { accountId: de.id } } });
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(d.sellerId).toBe("acme");
      // Prospect facts come from (sample) research; the seller identity must be Acme only.
      expect(`${d.subject} ${d.body}`).not.toMatch(/Manch|manchtech|Team Manch/i);
      expect(d.body).toMatch(/Acme/);
    }
  });
});
