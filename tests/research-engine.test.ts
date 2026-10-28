// Acceptance tests from "Trilliant Universal AI Research Brain Architecture" §16.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { claimFidelity, explicitIntent, factStatus, independentReports, reportFingerprint } from "@/lib/pipeline/gates";
import { guardClass } from "@/lib/brain/investigate";
import { assessCompleteness } from "@/lib/brain/completeness";
import { scopeWhere } from "@/lib/scope";
import type { ResearchPage } from "@/lib/adapters/types";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
}
async function account(domain: string) {
  const r = await ingestRows([{ company: domain.split(".")[0], domain, industry: "fmcg", employees: 1500, country: "IN", contactName: "Asha Mehta", title: "VP Data", email: `asha.mehta@${domain}` }], { source: "test" });
  return r.accountIds[0];
}
const DAY = 86_400_000;
const recent = new Date(Date.now() - 10 * DAY);

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

describe("research engine — acceptance tests", () => {
  it("an acquisition with no client-relevant consequence does not become buying intent", () => {
    const acq = [{ quote: "Acme Foods has completed its acquisition of Beta Snacks.", sourceUrl: "https://a.example/x", fingerprint: "fp1", status: "verified" as const }];
    // Even if a model calls it intent, code needs a source that states an evaluation, tender or purchase.
    expect(guardClass("direct_intent", acq).classification).not.toBe("direct_intent");
    expect(explicitIntent(acq[0].quote)).toBe(false);
    expect(explicitIntent("Acme Foods has issued an RFP for a vendor master data platform.")).toBe(true);
  });

  it("a copied press release on five sites counts as one underlying report", () => {
    const quote = "Acme Foods will add 2,000 distributors across East India this year, the company said.";
    const fp = reportFingerprint(quote);
    const copies = ["a.example", "b.example", "c.example", "d.example", "e.example"].map((h, i) => ({ id: String(i), key: "trigger", value: null, sourceType: "news", sourceUrl: `https://${h}/story`, publishedAt: recent, fingerprint: fp }));
    expect(independentReports(copies)).toBe(1);
    expect(factStatus(copies, "trigger")).toBe("probable");
    // A genuinely different report on another site corroborates.
    expect(factStatus([...copies, { ...copies[0], id: "x", sourceUrl: "https://f.example/s", fingerprint: reportFingerprint("Acme Foods confirmed to investors that 2,000 new distributors are planned.") }], "trigger")).toBe("verified");
  });

  it("a quote about another company cannot validate the target's claim", () => {
    const r = claimFidelity("Acme Foods is migrating to SAP S/4HANA", "Beta Snacks is migrating to SAP S/4HANA next year.", ["acme"], "Beta Snacks is migrating to SAP S/4HANA next year.");
    expect(r.pass).toBe(false);
    // A claim may not add numbers the quote doesn't state.
    expect(claimFidelity("Acme Foods adds 5,000 distributors", "Acme Foods adds 3,000 distributors this year.", ["acme"]).pass).toBe(false);
    expect(claimFidelity("Acme Foods adds 3,000 distributors", "Acme Foods adds 3,000 distributors this year.", ["acme"]).pass).toBe(true);
  });

  it("an exhausted budget or round limit yields incomplete research, not a negative conclusion", () => {
    const c = assessCompleteness({ requiredKeys: ["trigger", "negative"], searchedKeys: ["trigger"], answeredKeys: [], hypotheses: [], disconfirmAsked: [], facts: {}, unasked: ["Is the ERP programme funded?"], capped: true, budgetHit: false });
    expect(c.complete).toBe(false);
    expect(c.gaps.join(" ")).toMatch(/Not searched: negative/);
    expect(c.nextQuestions).toContain("Is the ERP programme funded?");
  });

  it("a strong company is investigated, connected, validated and the run is recorded", async () => {
    const id = await account("strong-research.com");
    const r = await runAccount(id);
    expect(r.status).toBe("done");
    const run = await db.researchRun.findFirstOrThrow({ where: { accountId: id } });
    expect(["complete", "incomplete"]).toContain(run.status);
    expect((run.trace as { questions: { purpose: string }[] }[])[0].questions[0].purpose).toBe("disconfirm");
    const h = await db.hypothesis.findFirstOrThrow({ where: { accountId: id } });
    expect(h.status).toBe("validated");
    expect(["supported_opportunity", "relevant_development"]).toContain(h.classification);
    expect(await db.evidenceLink.count({ where: { accountId: id } })).toBeGreaterThan(0);
  });

  it("a hidden opportunity found only after several follow-ups is still found", async () => {
    const a = createMockAdapters();
    const base = a.research.search.bind(a.research);
    a.research.search = async (domain, name, key, pass, hint = {}) => {
      if (key === "investigation") {
        const hit = hint.query?.includes("phase two");
        hint.onAttempt?.({ engine: "mock", results: hit ? 1 : 0 });
        return hit ? [{ url: `https://ops.example.org/${domain}/phase-two`, sourceType: "news", publishedAt: recent, title: `${name} plans phase two of its vendor onboarding rebuild`, text: `${name} plans phase two of its vendor onboarding rebuild.`, engine: "mock" } as ResearchPage] : [];
      }
      return base(domain, name, key, pass, hint);
    };
    a.llm.investigate = async (input) => {
      const q = input.round === 1 ? "rollout timeline" : input.round === 2 ? "supplier portal" : "phase two vendor onboarding";
      return { hypotheses: input.hypotheses.length ? [] : [{ ref: "new", text: "Vendor onboarding rebuild may need the client's onboarding product", useCase: null, assumptions: [], supportIds: [], counterIds: [] }], questions: input.round <= 3 ? [{ question: `Ask about ${q}`, query: `"${input.company.name}" ${q}`, purpose: "discover" as const, hypothesisRef: input.hypotheses[0]?.id ?? "new", value: 5, why: "Could reveal the programme" }] : [], done: input.round > 3, doneWhy: "" };
    };
    setAdapters(a);
    const id = await account("strong-hidden.com");
    await db.account.update({ where: { id }, data: { tier: "T1", tierLocked: true } });
    await runAccount(id);
    const found = await db.evidence.findFirst({ where: { accountId: id, key: "investigation", claim: { contains: "phase two" } } });
    expect(found).not.toBeNull();
    const h = await db.hypothesis.findFirstOrThrow({ where: { accountId: id } });
    expect(h.supportIds).toContain(found!.id);
    expect((await db.researchRun.findFirstOrThrow({ where: { accountId: id } })).rounds).toBeGreaterThanOrEqual(3);
  });

  it("a validator can send a weak inference back for more investigation", async () => {
    const a = createMockAdapters();
    let calls = 0;
    a.validator.validateResearch = async (input) => {
      calls++;
      return { results: input.hypotheses.map((h) => (calls === 1 ? { hypothesisId: h.id, verdict: "needs_research" as const, classification: "relevant_development" as const, issues: ["The link between the programme and onboarding is assumed"], alternatives: ["The programme may only cover finance"], repairQuestions: [{ question: "Does the programme cover distributor onboarding?", query: `"x" distributor onboarding programme scope` }] } : { hypothesisId: h.id, verdict: "upheld" as const, classification: h.classification as "relevant_development", issues: [], alternatives: [], repairQuestions: [] })) };
    };
    setAdapters(a);
    const id = await account("strong-repair.com");
    await runAccount(id);
    const run = await db.researchRun.findFirstOrThrow({ where: { accountId: id } });
    const trace = run.trace as { note?: string; questions: { purpose: string }[] }[];
    expect(trace.some((r) => r.note?.startsWith("Repair"))).toBe(true);
    expect(calls).toBe(2);
  });

  it("an outreach email cannot assert a hypothesis as an established fact", async () => {
    const a = createMockAdapters();
    a.llm.auditEmail = async (i) => ({ sentences: [{ text: `${i.company} struggles with duplicate vendor records.`, aboutProspect: true, kind: "hypothesis" as const, supported: false, factIds: [], phrasedAsHypothesis: false, reason: "a guess stated as fact" }] });
    setAdapters(a);
    const id = await account("strong-audit.com");
    await runAccount(id);
    const drafts = await db.draft.findMany({ where: { contact: { accountId: id } } });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.status === "blocked")).toBe(true);
    expect(drafts[0].blockReason ?? "").toMatch(/rephrase as a question|States a guess/);
  });

  it("concurrent clients cannot read each other's investigations", () => {
    for (const m of ["ResearchRun", "Hypothesis", "EvidenceLink"] as const) expect(scopeWhere(m, ["manch"])).toEqual({ account: { sellerId: { in: ["manch"] } } });
  });
});

describe("research benchmark", () => {
  it("every code check meets the 90% precision and recall target on the labelled cases", async () => {
    const { runBench, THRESHOLD } = await import("../scripts/bench");
    for (const [k, v] of Object.entries(runBench())) {
      expect(v.precision, `${k} precision`).toBeGreaterThanOrEqual(THRESHOLD);
      expect(v.recall, `${k} recall`).toBeGreaterThanOrEqual(THRESHOLD);
    }
  });
});
