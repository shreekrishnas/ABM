import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { pickOfficialSite, researchDepth, intakeMap } from "@/lib/research/intake";
import { isTriggerKey } from "@/lib/research/keys";
import { ruleBrief } from "@/lib/brain/rules";
import type { BriefInput } from "@/lib/brain/types";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
}

const page = (url: string, title: string, text = title) => ({ url, title, text, sourceType: "news" as const, publishedAt: new Date() });

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

describe("intake: pure rules", () => {
  it("picks the company's own site, not LinkedIn, directories or news", () => {
    const pages = [
      page("https://www.linkedin.com/company/trident-auto", "Trident Auto Components | LinkedIn"),
      page("https://www.zaubacorp.com/company/trident-auto", "Trident Auto Components - company info"),
      page("https://www.autonews.example/trident-wins-order", "Trident Auto Components wins export order"),
      page("https://www.tridentauto.in/about", "About us — Trident Auto Components"),
    ];
    expect(pickOfficialSite(pages, "Trident Auto Components Pvt Ltd")).toEqual({ domain: "tridentauto.in", url: "https://www.tridentauto.in/about" });
    expect(pickOfficialSite(pages.slice(0, 3), "Trident Auto Components")).toBeNull();
  });

  it("chooses research depth from tier and LinkedIn engagement", () => {
    const none = { technologies: [], keywords: [], notes: null, conversations: [] };
    expect(researchDepth("T1", none).depth).toBe("deep");
    expect(researchDepth("T2", none)).toMatchObject({ deepKeys: 2 });
    expect(researchDepth("T3", none)).toMatchObject({ depth: "core", deepKeys: 0 });
    const engaged = { ...none, conversations: [{ name: "Asha Mehta", title: "Head of Master Data", stage: "Interested", lastReply: "Yes", sender: "Sender 1" }] };
    expect(researchDepth("T3", engaged).reason).toBe("deep — engaged on LinkedIn: Asha Mehta (Interested)");
  });

  it("deep-dive answers count as buying triggers", () => {
    expect(["trigger", "erp_program", "expansion", "leadership"].every(isTriggerKey)).toBe(true);
    expect(isTriggerKey("compliance")).toBe(false);
  });

  it("a running LinkedIn conversation drives the brief's next best action", () => {
    const input = {
      company: { name: "Sahyadri Beverages", domain: "sahyadribev.in", industry: "beverages", employees: 6500, country: "IN", technologies: [], fitScore: 96, fitReasons: [] },
      facts: [], inferences: [], negatives: [], unknowns: [], hypotheses: [], learnings: [],
      seller: { name: "Manch Technologies", products: [], useCases: [], personas: [], proofPoints: [], competitors: [] },
      imported: { technologies: [], keywords: [], notes: null, conversations: [{ name: "Asha Mehta", title: "Head of Master Data", stage: "Interested", lastReply: "Yes, we are interested.", sender: "Sender 1 — Priya" }] },
    } as BriefInput;
    expect(ruleBrief(input).nextBestAction).toMatch(/^Asha Mehta \(Head of Master Data\) is interested on LinkedIn via Sender 1 — Priya/);
  });
});

describe("intake: import → research in the pipeline", () => {
  it("an unfindable website is reported, and the run continues on known fields", async () => {
    // The sample research treats this name as having only directory listings.
    const r = await ingestRows([{ "Company Name": "Trident Auto Components", "Company LinkedIn URL": "linkedin.com/company/trident-auto", Industry: "manufacturing", "Employee Size": "3100", Country: "IN" }], { source: "csv" });
    await runAccount(r.accountIds[0]);
    expect((await db.account.findUniqueOrThrow({ where: { id: r.accountIds[0] } })).domain).toBeNull();
    expect(await db.pipelineEvent.count({ where: { accountId: r.accountIds[0], step: "intake.website", outcome: "block", reason: { contains: "add Company Website" } } })).toBe(1);
    expect((await db.account.findUniqueOrThrow({ where: { id: r.accountIds[0] } })).fitScore).toBeGreaterThan(80);
  });

  it("a company imported without a website gets it from research before identity runs", async () => {
    const r = await ingestRows([{ "Company Name": "Delta Beverages", "Company LinkedIn URL": "linkedin.com/company/delta-beverages", Industry: "beverages", "Employee Size": "3100", Country: "IN", "First Name": "Daniel", "Last Name": "DSouza", "Job Title": "Head of Procurement" }], { source: "csv" });
    const id = r.accountIds[0];
    await runAccount(id);
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.domain).toBe("deltabeverages.in");
    const fs = await db.fieldState.findFirstOrThrow({ where: { accountId: id, field: "domain" } });
    expect(fs.source).toMatch(/^research: https:\/\/www\.deltabeverages\.in/);
    expect(fs.status).toBe("probable");
    expect(await db.pipelineEvent.count({ where: { accountId: id, step: "identity.current_role_check", reason: { contains: "domain unknown" } } })).toBe(0);
    expect(await db.researchQuery.count({ where: { accountId: id, key: "website" } })).toBeGreaterThan(0);
  });

  it("fills missing industry, size and country from research — never overwrites imported values", async () => {
    const r = await ingestRows([{ "Company Name": "Kaveri Foods", "Company Website": "strong-kaveri.com", Industry: "fmcg", "First Name": "Ravi" }], { source: "csv" });
    const id = r.accountIds[0];
    await runAccount(id, { fromStage: 2 });
    const a = await db.account.findUniqueOrThrow({ where: { id } });
    expect(a.industry).toBe("fmcg"); // imported, kept
    expect(a.employees).toBeGreaterThan(0); // researched
    expect(a.country).toBe("IN"); // researched
    const emp = await db.fieldState.findFirstOrThrow({ where: { accountId: id, field: "employees" } });
    expect(emp.source).toBe("research: https://strong-kaveri.com/about");
    const map = await intakeMap(a);
    expect(map.filter((f) => f.gap).map((f) => f.key)).toEqual([]);
  });

  it("does not search for what the import already gave, and goes deep for T1", async () => {
    const r = await ingestRows([{ "Company Name": "Sahyadri Beverages", "Company Website": "strong-sahyadri.com", Industry: "beverages", "Employee Size": "6500", Country: "IN", "Technologies Used": "SAP ECC", "First Name": "Asha", "Job Title": "Head of Master Data" }], { source: "csv" });
    await runAccount(r.accountIds[0]);
    const plan = await db.researchPlan.findFirstOrThrow({ where: { accountId: r.accountIds[0] } });
    const keys = (plan.questions as { key: string }[]).map((q) => q.key);
    expect(keys).not.toContain("tooling");
    expect(plan.skipped as { key: string; reason: string }[]).toContainEqual({ key: "tooling", reason: "Known from import: SAP ECC" });
    expect(keys).toEqual(expect.arrayContaining(["erp_program", "expansion", "compliance"]));
    expect(plan.depth).toBe("deep — T1 company");
    expect(await db.evidence.count({ where: { accountId: r.accountIds[0], key: "erp_program" } })).toBe(1);
  });

  it("a LinkedIn reply in the import earns a deep dive and reaches the brief", async () => {
    const campaign = await db.campaign.create({ data: { name: "Q4" } });
    const sender = await db.senderProfile.create({ data: { name: "Sender 1 — Priya" } });
    // A mid-size company (T2 by fit) where someone already said they are interested.
    const r = await ingestRows(
      [{ "Company Name": "Strong Mid Foods", "Company Website": "strong-midfoods.com", Industry: "fmcg", "Employee Size": "450", Country: "IN", "First Name": "Asha", "Last Name": "Mehta", "Job Title": "Head of Master Data", "Connection Sent": "2026-09-20", "Connection Accepted": "2026-09-22", "Last Reply": "Yes, we are interested.", "Last Reply Date": "2026-09-30" }],
      { source: "csv", campaignId: campaign.id, senderId: sender.id },
    );
    await runAccount(r.accountIds[0]);
    const plan = await db.researchPlan.findFirstOrThrow({ where: { accountId: r.accountIds[0] } });
    expect(plan.depth).toBe("deep — engaged on LinkedIn: Asha Mehta (Interested)");
    const brief = await db.accountBrief.findFirstOrThrow({ where: { accountId: r.accountIds[0] } });
    expect((brief.brief as { nextBestAction: string }).nextBestAction).toMatch(/Asha Mehta .* interested on LinkedIn/);
  });

  it("a website found for one company that belongs to another goes to review, not overwritten", async () => {
    await ingestRows([{ "Company Name": "Other Co", "Company Website": "deltabeverages.in" }], { source: "csv" });
    const r = await ingestRows([{ "Company Name": "Delta Beverages", "Company LinkedIn URL": "linkedin.com/company/delta-beverages", Industry: "beverages", "Employee Size": "3100", Country: "IN" }], { source: "csv" });
    await runAccount(r.accountIds[0], { fromStage: 2 });
    expect((await db.account.findUniqueOrThrow({ where: { id: r.accountIds[0] } })).domain).toBeNull();
    expect(await db.reviewItem.count({ where: { accountId: r.accountIds[0], type: "other", reason: { contains: "belongs to Other Co" } } })).toBe(1);
  });
});
