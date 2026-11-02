// Onboarding acceptance test: brand-new companies (different industries, countries, sizes, with and
// without a website, with one or several people) go through the WHOLE pipeline the same way the
// current accounts do. Nothing here is specific to an existing company: if a new account is added,
// this is what it gets.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { latestBrief } from "@/lib/brain/strategist";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
}

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

type Row = Record<string, string | number>;
const person = (company: string, domain: string, name: string, title: string): Row => ({ company, domain, contactName: name, title, email: `${name.split(" ")[0].toLowerCase()}@${domain}` });

/** Every step a new account must pass through, with the output each step must leave behind. */
async function expectFullRun(accountId: string) {
  const a = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const [evidence, twin, contacts, drafts, fins, techs, errors, steps] = await Promise.all([
    db.evidence.findMany({ where: { accountId } }),
    db.twinVersion.findFirst({ where: { accountId } }),
    db.contact.findMany({ where: { accountId, mergedIntoId: null } }),
    db.draft.findMany({ where: { contact: { accountId } } }),
    db.companyFinancial.count({ where: { accountId } }),
    db.techUse.count({ where: { accountId } }),
    db.pipelineEvent.findMany({ where: { accountId, outcome: "error" } }),
    db.pipelineEvent.findMany({ where: { accountId }, select: { step: true } }),
  ]);
  const ran = new Set(steps.map((s) => s.step.split(".")[0]));
  // 1–3 intake, clean-up, fit and tier
  expect(a.fitScore).not.toBeNull();
  expect(a.fitReasons.length).toBeGreaterThan(0);
  expect(a.tier).toMatch(/^T[123]$/);
  for (const s of ["fit_tier", "research_plan", "account_research", "company_profile", "account_twin", "buying_group"]) expect(ran.has(s)).toBe(true);
  // 6 research: facts with a source and a status
  expect(evidence.length).toBeGreaterThan(0);
  expect(evidence.every((e) => e.sourceUrl.startsWith("http") && ["verified", "probable", "stale", "conflicting", "invalid", "unknown"].includes(e.status))).toBe(true);
  // 6 company profile: financials and technologies; summary saved
  expect(fins).toBeGreaterThan(0);
  expect(techs).toBeGreaterThan(0);
  expect(a.profileUpdatedAt).not.toBeNull();
  expect(a.financialHealth).not.toBeNull();
  // 7 twin, intent, priority, brief
  expect(twin).not.toBeNull();
  expect(a.intentReading).not.toBeNull();
  expect(a.priorityScore).not.toBeNull();
  expect(await latestBrief(accountId)).not.toBeNull();
  // 8 buying group mapped
  expect(contacts.some((c) => c.buyingRole !== "unknown")).toBe(true);
  // 10–11 readiness → drafts waiting for a person, every claim citing a fact, compliant footer
  expect(drafts.length).toBeGreaterThan(0);
  expect(drafts.every((d) => d.status === "pending_review")).toBe(true);
  expect(drafts.every((d) => (d.claims as { factIds: string[] }[]).every((c) => c.factIds.length > 0))).toBe(true);
  expect(drafts.every((d) => /unsubscribe/i.test(d.body))).toBe(true);
  // Origin recorded, and nothing errored along the way
  expect(a.addedVia).toBe("csv");
  expect(a.addedBy).toBe("new.user@trilliant.test");
  expect(errors.map((e) => `${e.step}: ${e.reason}`)).toEqual([]);
}

describe("a new account gets the same research as the existing ones", () => {
  const cases: { label: string; rows: Row[]; tier?: string }[] = [
    { label: "large manufacturer, several people", rows: [
      { ...person("Strong Kestrel Industries", "strong-kestrel.in", "Ritu Sharma", "Chief Information Officer"), industry: "manufacturing", employees: 12000, country: "IN" },
      person("Strong Kestrel Industries", "strong-kestrel.in", "Arvind Rao", "Head of Procurement"),
      person("Strong Kestrel Industries", "strong-kestrel.in", "Meghna Iyer", "Head of Master Data"),
    ] },
    { label: "mid-size FMCG, one person", rows: [{ ...person("Strong Lotusleaf Foods", "strong-lotusleaf.in", "Kiran Patel", "VP Data"), industry: "fmcg", employees: 900, country: "IN" }] },
    { label: "fintech lender, abroad (expansion market)", rows: [{ ...person("Strong Harbour Finance", "strong-harbour.ae", "Omar Haddad", "Chief Digital Officer"), industry: "nbfc lending", employees: 1500, country: "AE" }] },
    { label: "pharma distributor, only name and domain in the file", rows: [{ ...person("Strong Medisphere Pharma", "strong-medisphere.in", "Neha Gupta", "Head of Data Platform") }] },
  ];

  for (const c of cases) {
    it(`${c.label}: import → fit → research → profile → twin and intent → brief → buying group → drafts`, async () => {
      const r = await ingestRows(c.rows, { source: "csv", filename: "new-accounts.csv", createdBy: "new.user@trilliant.test" });
      expect(r.rejected).toBe(0);
      expect(r.accountIds.length).toBe(1);
      const run = await runAccount(r.accountIds[0]);
      expect(run.status, run.reason).toBe("done");
      await expectFullRun(r.accountIds[0]);
    });
  }

  it("re-uploading the same account updates it without duplicates or a second run of fresh research", async () => {
    const rows = [{ ...person("Strong Kestrel Industries", "strong-kestrel.in", "Ritu Sharma", "Chief Information Officer"), industry: "manufacturing", employees: 12000, country: "IN" }];
    const first = await ingestRows(rows, { source: "csv", filename: "a.csv", createdBy: "new.user@trilliant.test" });
    await runAccount(first.accountIds[0]);
    const searches = await db.researchQuery.count({ where: { accountId: first.accountIds[0], cached: false } });
    const again = await ingestRows(rows, { source: "csv", filename: "a.csv", createdBy: "someone.else@trilliant.test" });
    expect(again.accountIds[0]).toBe(first.accountIds[0]);
    expect(await db.account.count()).toBe(1);
    expect(await db.contact.count({ where: { accountId: first.accountIds[0], fullName: "Ritu Sharma" } })).toBe(1);
    await runAccount(first.accountIds[0], { fromStage: 5 });
    // Fresh answers are served from cache or skipped: no extra paid searches.
    expect(await db.researchQuery.count({ where: { accountId: first.accountIds[0], cached: false } })).toBe(searches);
    expect((await db.account.findUniqueOrThrow({ where: { id: first.accountIds[0] } })).addedBy).toBe("new.user@trilliant.test");
  });

  it("any new account ends in a known, explained outcome — never an error — whatever research finds", async () => {
    // Real-looking companies with no forced scenario: research may find strong evidence, weak evidence,
    // layoffs, an acquisition or conflicting facts. Each must end in a documented outcome with a reason.
    const names = ["Orchid Agro Exports", "Bluefin Logistics", "Cedar Point Retail", "Northgate Ceramics", "Sapphire Auto Parts", "Tidewater Chemicals", "Vertex Healthcare Distribution", "Maple Leaf Textiles"];
    for (const n of names) {
      const domain = `${n.toLowerCase().replace(/[^a-z]+/g, "")}.in`;
      const r = await ingestRows([{ ...person(n, domain, "Sunil Verma", "Chief Financial Officer"), industry: "manufacturing", employees: 2500, country: "IN" }], { source: "csv", createdBy: "new.user@trilliant.test" });
      const run = await runAccount(r.accountIds[0]);
      expect(["done", "blocked"], `${n}: ${run.reason}`).toContain(run.status);
      expect(run.reason.length, n).toBeGreaterThan(0);
      const a = await db.account.findUniqueOrThrow({ where: { id: r.accountIds[0] } });
      const [drafts, watch, review, errors] = await Promise.all([
        db.draft.count({ where: { contact: { accountId: a.id } } }),
        db.watchlistEntry.count({ where: { accountId: a.id } }),
        db.reviewItem.count({ where: { accountId: a.id } }),
        db.pipelineEvent.count({ where: { accountId: a.id, outcome: "error" } }),
      ]);
      // Drafts for a person to approve, a watchlist re-check date, or an item in Approvals: always one of these.
      expect(drafts + watch + review, `${n} ended without drafts, a watch date or a review item (${run.reason})`).toBeGreaterThan(0);
      expect(errors, n).toBe(0);
      expect(a.fitScore, n).not.toBeNull();
    }
  });
});
