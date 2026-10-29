import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { setAdapters, getAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { MANCH } from "@/lib/seller/manch";
import { SELLERS } from "@/lib/seller";
import { ingestRows } from "@/lib/pipeline/ingest";
import { newContext } from "@/lib/pipeline/context";
import { findLookalikes, mergeEvidence, processLookalikeQueue, requestMoreResearch, scoreLookalike, type LookalikeEvidence, type LookalikeResearch } from "@/lib/discover/lookalike";
import { addSuggestion, dismissSuggestion } from "@/lib/discover/scan";
import { ApprovalRequired, approvalGated, contactLookupAllowed } from "@/lib/discover/approval";
import type { DataProvider } from "@/lib/adapters/types";

let saved: { mustHave: typeof MANCH.icp.mustHave; lookalike: typeof MANCH.lookalike };
beforeAll(() => {
  saved = { mustHave: MANCH.icp.mustHave, lookalike: MANCH.lookalike };
  MANCH.icp.mustHave = { countries: ["IN"], minEmployees: 5001 };
});
afterAll(() => {
  MANCH.icp.mustHave = saved.mustHave;
  MANCH.lookalike = saved.lookalike;
});
beforeEach(async () => {
  MANCH.lookalike = undefined;
  setAdapters(createMockAdapters());
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
});

const spyProvider = () => {
  const calls: string[] = [];
  const p: DataProvider = {
    name: "spy",
    lookupPerson: async (q) => (calls.push(`lookup:${q.domain}`), null),
    recheckPerson: async (q) => (calls.push(`recheck:${q.domain}`), null),
    findByFunction: async (d) => (calls.push(`people:${d}`), []),
    findEmail: async (_n, d) => (calls.push(`email:${d}`), null),
  };
  return { p, calls };
};

describe("Lookalikes: discovery and investigation", () => {
  it("finds similar companies, queues the best for investigation and adds nothing before approval", async () => {
    const r = await findLookalikes("https://www.kaverifoods.in", newContext());
    expect(r.found).toBeGreaterThan(3);
    expect(r.suggested).toBeGreaterThan(0);
    const all = await db.prospectSuggestion.findMany({ where: { origin: "lookalike" } });
    expect(all.find((s) => s.name === "Narmada Pharma")).toMatchObject({ status: "new", researchStatus: "queued" });
    expect(all.find((s) => s.name === "Marina Retail Group")).toMatchObject({ status: "excluded" }); // outside the targeting rule: not investigated
    expect(all.find((s) => s.name === "Marina Retail Group")!.researchStatus).toBeNull();
    expect(await db.account.count()).toBe(0);
  });

  it("investigates in rounds the AI chooses, keeps quoted facts, verifies them across sources and scores fit and readiness", async () => {
    await findLookalikes("https://www.kaverifoods.in", newContext());
    const q = await processLookalikeQueue({ budgetMs: 60_000 });
    expect(q.remaining).toBe(0);
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma" } });
    expect(s.researchStatus).toBe("done");
    expect(s.fitScore).toBeGreaterThan(0);
    expect(s.readiness).toBe("ready"); // a buying event found on two independent sites
    expect(s.reasons.length).toBeGreaterThan(0);
    const ev = s.evidence as unknown as LookalikeEvidence[];
    expect(ev.some((e) => e.dimension === "intent" && e.verified && e.sources >= 2)).toBe(true);
    expect(ev.every((e) => e.quote.length > 0 && e.urls.length > 0)).toBe(true);
    const research = s.research as unknown as LookalikeResearch;
    expect(research.rounds.length).toBeGreaterThan(0);
    expect(research.rounds[0].questions.map((x) => x.engine)).toEqual(expect.arrayContaining(["exa", "tavily"]));
    // Still waiting for a person.
    expect(s.status).toBe("new");
    expect(await db.account.count()).toBe(0);
  });

  it("never calls the contact provider (Apollo) during discovery or investigation", async () => {
    const { p, calls } = spyProvider();
    setAdapters({ ...getAdapters(), provider: approvalGated(p) });
    await findLookalikes("https://www.kaverifoods.in", newContext());
    await processLookalikeQueue({ budgetMs: 60_000 });
    expect(calls).toEqual([]);
  });

  it("a person can ask for more research; the AI answers their question in new rounds", async () => {
    await findLookalikes("https://www.kaverifoods.in", newContext());
    await processLookalikeQueue({ budgetMs: 60_000 });
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma" } });
    const before = (s.research as unknown as LookalikeResearch).rounds.length;
    await requestMoreResearch(s.id, "Do they run their own distributor portal?");
    await processLookalikeQueue({ budgetMs: 60_000 });
    const after = await db.prospectSuggestion.findUniqueOrThrow({ where: { id: s.id } });
    const rounds = (after.research as unknown as LookalikeResearch).rounds;
    expect(rounds.length).toBe(before + 1);
    expect(rounds.at(-1)!.questions[0].question).toBe("Do they run their own distributor portal?");
    expect(after.researchNote).toBeNull();
    expect(after.researchStatus).toBe("done");
  });

  it("uses each client's own criteria: a rule-out sets a company aside", async () => {
    MANCH.lookalike = { avoid: ["pharmaceuticals"] };
    await findLookalikes("https://www.kaverifoods.in", newContext());
    await processLookalikeQueue({ budgetMs: 60_000 });
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma" } });
    expect(s.status).toBe("excluded");
    expect(s.reason).toMatch(/rule-out.*pharmaceuticals/);
  });

  it("each client's queued research runs under that client's own criteria", async () => {
    SELLERS.other = { ...MANCH, id: "other", name: "Other Co", lookalike: undefined };
    try {
      MANCH.lookalike = { avoid: ["pharmaceuticals"] };
      await findLookalikes("https://www.kaverifoods.in", newContext());
      const mine = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma" } });
      const { id: _id, ...copy } = mine;
      void _id;
      await db.prospectSuggestion.create({ data: { ...copy, sellerId: "other", seedProfile: copy.seedProfile ?? undefined, sources: copy.sources ?? [], evidence: undefined, research: undefined } });
      await processLookalikeQueue({ budgetMs: 60_000 });
      expect(await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma", sellerId: "manch" } })).toMatchObject({ status: "excluded" });
      expect(await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma", sellerId: "other" } })).toMatchObject({ status: "new", researchStatus: "done" });
    } finally {
      delete SELLERS.other;
    }
  });

  it("a client whose settings can't load is marked failed and the queue moves on", async () => {
    await findLookalikes("https://www.kaverifoods.in", newContext());
    const one = await db.prospectSuggestion.findFirstOrThrow({ where: { researchStatus: "queued" } });
    await db.prospectSuggestion.update({ where: { id: one.id }, data: { sellerId: "missing-client" } });
    const r = await processLookalikeQueue({ budgetMs: 60_000 });
    expect(r.remaining).toBe(0);
    expect(await db.prospectSuggestion.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ researchStatus: "failed" });
  });

  it("only this client's limit of companies is investigated per search", async () => {
    MANCH.lookalike = { candidates: 2 };
    const r = await findLookalikes("https://www.kaverifoods.in", newContext());
    expect(r.suggested).toBe(2);
    expect(await db.prospectSuggestion.count({ where: { researchStatus: "queued" } })).toBe(2);
  });
});

describe("Lookalikes: scoring rules", () => {
  const dims = { business_model: 90, operations: 90, industry: 90, scale: 90, offering: 90 };
  const fact = (o: Partial<LookalikeEvidence>): LookalikeEvidence => ({ claim: "x", quote: "x", url: "https://a.example", publisher: "a.example", at: "", dimension: "operations", sources: 1, urls: ["https://a.example"], verified: false, ...o });

  it("without any verified fact, the fit is capped at 50", () => {
    expect(scoreLookalike({ dims, readiness: "early", readinessScore: 20 }, [fact({})]).fit).toBe(50);
    expect(scoreLookalike({ dims, readiness: "early", readinessScore: 20 }, [fact({ verified: true })]).fit).toBe(90);
  });

  it("'ready' needs a verified buying event; anything above 'early' needs an event at all", () => {
    expect(scoreLookalike({ dims, readiness: "ready", readinessScore: 90 }, [fact({ dimension: "intent" })])).toMatchObject({ readiness: "emerging", readinessScore: 65 });
    expect(scoreLookalike({ dims, readiness: "ready", readinessScore: 90 }, [fact({ verified: true })])).toMatchObject({ readiness: "early", readinessScore: 35 });
    expect(scoreLookalike({ dims, readiness: "ready", readinessScore: 90 }, [fact({ dimension: "intent", verified: true })]).readiness).toBe("ready");
  });

  it("a fact is verified by two independent sites, or by the company's own site (not for buying events)", () => {
    const base = { claim: "Runs eight plants and a distributor network", quote: "q", publisher: "", at: "", dimension: "operations" as const };
    expect(mergeEvidence([{ ...base, url: "https://news.example.com/a" }, { ...base, url: "https://other.example.org/b" }], null)[0]).toMatchObject({ verified: true, sources: 2 });
    expect(mergeEvidence([{ ...base, url: "https://www.acme.in/about" }], "acme.in")[0].verified).toBe(true);
    expect(mergeEvidence([{ ...base, dimension: "intent", url: "https://www.acme.in/news" }], "acme.in")[0].verified).toBe(false);
  });
});

describe("Lookalikes: human approval before any contact lookup", () => {
  it("contact lookups are refused until a person approves the company, then allowed", async () => {
    await findLookalikes("https://www.kaverifoods.in", newContext());
    await processLookalikeQueue({ budgetMs: 60_000 });
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { name: "Narmada Pharma" } });
    await db.prospectSuggestion.update({ where: { id: s.id }, data: { domain: "narmadapharma.in" } });
    const { p, calls } = spyProvider();
    const gated = approvalGated(p);

    expect(await contactLookupAllowed("narmadapharma.in")).toBe(false);
    await expect(gated.findByFunction("narmadapharma.in", "it", 2)).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(gated.findEmail("Asha Rao", "narmadapharma.in")).rejects.toBeInstanceOf(ApprovalRequired);
    expect(calls).toEqual([]);

    const accountId = await addSuggestion(s.id, "reviewer@trilliantdigital.com");
    expect(accountId).toBeTruthy();
    expect(await db.prospectSuggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "added", decidedBy: "reviewer@trilliantdigital.com" });
    expect(await contactLookupAllowed("narmadapharma.in")).toBe(true);
    await gated.findByFunction("narmadapharma.in", "it", 2);
    expect(calls).toEqual(["people:narmadapharma.in"]);
  });

  it("a rejected company never reaches the contact provider; one still being researched can't be approved", async () => {
    await findLookalikes("https://www.kaverifoods.in", newContext());
    const queued = await db.prospectSuggestion.findFirstOrThrow({ where: { researchStatus: "queued" } });
    expect(await addSuggestion(queued.id)).toBeNull();
    await processLookalikeQueue({ budgetMs: 60_000 });
    await dismissSuggestion(queued.id, "reviewer@trilliantdigital.com", "Rejected: too small");
    expect(await db.prospectSuggestion.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "dismissed", reason: "Rejected: too small" });
    expect(await db.account.count()).toBe(0);
    const { p, calls } = spyProvider();
    await expect(approvalGated(p).findByFunction(queued.domain ?? "unknown.example", "it", 2)).rejects.toBeInstanceOf(ApprovalRequired);
    expect(calls).toEqual([]);
  });

  it("companies a person imported count as approved", async () => {
    await ingestRows([{ "Company Name": "Saffron Foods", "Company Website": "saffronfoods.in" }], { source: "csv" });
    expect(await contactLookupAllowed("saffronfoods.in")).toBe(true);
    expect(await contactLookupAllowed("never-seen.example")).toBe(false);
  });
});

vi.setConfig({ testTimeout: 60_000 });
