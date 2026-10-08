import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { mergePlan } from "@/lib/brain/plan";
import { assignPainPoints, pickAngle, sanitizeBrief } from "@/lib/brain/strategist";
import { flagFact } from "@/lib/brain/feedback";
import { computeStats, generateInsights, latestLearnings } from "@/lib/brain/insights";
import { ruleCheckClaims, ruleInsights } from "@/lib/brain/rules";
import type { AccountBriefData } from "@/lib/brain/types";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) {
    await db.sequence.create({ data: { name: `${tier} seq`, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead with trigger" }] } } });
  }
}

async function account(domain: string, people: [string, string][] = [["Asha Mehta", "VP Data"], ["Daniel Okafor", "Head of Data Platform"]], extra: Record<string, unknown> = {}) {
  const res = await ingestRows(
    people.map(([name, title]) => ({ company: domain.split(".")[0], domain, industry: "fmcg", employees: 1500, country: "IN", contactName: name, title, email: `${name.toLowerCase().replace(" ", ".")}@${domain}`, ...extra })),
    { source: "test" },
  );
  return res.accountIds[0];
}

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});
afterEach(() => setAdapters(createMockAdapters()));

describe("brain: pure rules", () => {
  it("mergePlan keeps high-importance questions, rejects unknown engines and off-target queries", () => {
    const candidates = [
      { key: "trigger", question: "What changed?", importance: "high" as const },
      { key: "tooling", question: "Stack?", importance: "medium" as const },
      { key: "partner_network", question: "Network?", importance: "medium" as const },
    ];
    const { questions, skipped } = mergePlan(
      candidates,
      {
        hypotheses: [],
        questions: [
          { key: "trigger", query: '"Kaveri Foods" S/4HANA', engine: "nonsense", why: "lead" },
          { key: "tooling", query: "some other company stack", engine: "exa", why: "stack" },
        ],
        skip: [{ key: "trigger", reason: "not needed" }, { key: "partner_network", reason: "inferred from industry" }],
      },
      ["exa", "serp"],
      "Kaveri Foods",
      { trigger: "serp" },
    );
    expect(questions.map((q) => q.key)).toEqual(["trigger", "tooling"]);
    expect(questions[0].query).toContain("S/4HANA");
    expect(questions[0].engine).toBe("serp"); // invalid engine → learned routing
    expect(questions[1].query).toContain('"Kaveri Foods"'); // off-target query replaced
    expect(skipped).toEqual([{ key: "partner_network", reason: "Brain: inferred from industry" }]);
  });

  it("sanitizeBrief drops pain points citing facts we don't hold and remaps persona angles", () => {
    const brief: AccountBriefData = {
      verdict: "strong", verdictWhy: "Fit and triggers",
      whyNow: { text: "Invented", factIds: ["ghost"] },
      painPoints: [
        { pain: "Made up pain", factIds: ["ghost"], useCase: "vendor_onboarding", capability: "x", confidence: "high" },
        { pain: "Real pain from S/4 move", factIds: ["f1", "ghost"], useCase: "distributor_onboarding", capability: "y", confidence: "medium" },
        { pain: "Bad use case", factIds: ["f1"], useCase: "teleportation", capability: "z", confidence: "low" },
      ],
      personaAngles: [{ role: "decision_maker", angle: "Speed", painIndex: 1 }, { role: "champion", angle: "Quality", painIndex: 0 }],
      hypotheses: [], risks: [], nextBestAction: "Call the CIO",
    };
    const s = sanitizeBrief(brief, new Set(["f1"]), ["vendor_onboarding", "distributor_onboarding"]);
    expect(s.whyNow).toBeNull();
    expect(s.painPoints).toHaveLength(1);
    expect(s.painPoints[0].factIds).toEqual(["f1"]);
    expect(s.personaAngles.map((a) => a.painIndex)).toEqual([0, 0]);
  });

  it("colleagues at the same company get different pain points until they run out", () => {
    const brief = {
      verdict: "strong", verdictWhy: "x", whyNow: null, hypotheses: [], risks: [], nextBestAction: "x",
      painPoints: [
        { pain: "A", factIds: ["f1"], useCase: "distributor_onboarding", capability: "ca", confidence: "high" },
        { pain: "B", factIds: ["f2"], useCase: "vendor_onboarding", capability: "cb", confidence: "high" },
      ],
      personaAngles: [{ role: "champion", angle: "hands-on", painIndex: 0 }, { role: "decision_maker", angle: "strategy", painIndex: 0 }],
    } as AccountBriefData;
    const m = assignPainPoints(brief, [{ id: "c1", role: "decision_maker" }, { id: "c2", role: "champion" }, { id: "c3", role: "champion" }]);
    expect([m.get("c1"), m.get("c2"), m.get("c3")]).toEqual([0, 1, 0]);
    expect(pickAngle(brief, "champion", m.get("c2")!)?.pain).toBe("B");
    expect(pickAngle(brief, "champion", 0)?.capability).toContain("hands-on");
    expect(pickAngle(null, "champion", 0)).toBeNull();
  });

  it("rule claim check flags a claim with nothing in common with its fact", () => {
    const r = ruleCheckClaims([
      { text: "Kaveri Foods announced its SAP S/4HANA migration", facts: [{ id: "f1", claim: "Kaveri Foods announced its SAP S/4HANA migration programme" }] },
      { text: "You just hired 400 engineers in Pune", facts: [{ id: "f1", claim: "Kaveri Foods announced its SAP S/4HANA migration programme" }] },
    ]);
    expect(r.map((x) => x.supported)).toEqual([true, false]);
  });

  it("rule insights refuse to conclude from small samples", () => {
    const s = ruleInsights({
      generatedAt: "", research: [], creditsSavedUsd: 0, minSample: 10, reviewer: { byUseCase: [], byRewrites: [] }, linkedin: { bySender: [], byRole: [] },
      messaging: { byUseCase: [{ label: "a", n: 3, hits: 3, rate: 1 }, { label: "b", n: 2, hits: 0, rate: 0 }], byRole: [], byTrigger: [], byTier: [] },
      review: { reviewed: 2, approvedAsIs: 2, edited: 0, rejected: 0, guardrailBlocked: 0, claimChecks: 0, claimsUnsupported: 0 },
      facts: { total: 0, flagged: 0, byEngine: [] }, fit: [],
    });
    expect(s.working).toHaveLength(0);
    expect(s.recommendations[0].text).toMatch(/at least 10/);
  });
});

describe("brain: pipeline", () => {
  it("plans research, writes a sourced brief and drafts with an angle and a passed claim check", async () => {
    const id = await account("strong-brain.com");
    expect((await runAccount(id)).status).toBe("done");

    const plan = await db.researchPlan.findFirstOrThrow({ where: { accountId: id } });
    expect(plan.planner).toBe("mock");
    expect((plan.questions as { query?: string }[]).every((q) => q.query?.includes("strong"))).toBe(true);

    const brief = await db.accountBrief.findFirstOrThrow({ where: { accountId: id } });
    const b = brief.brief as unknown as AccountBriefData;
    const evidenceIds = new Set((await db.evidence.findMany({ where: { accountId: id } })).map((e) => e.id));
    expect(b.painPoints.length).toBeGreaterThan(0);
    expect(b.painPoints.every((p) => p.factIds.every((f) => evidenceIds.has(f)))).toBe(true);

    const drafts = await db.draft.findMany({ where: { contact: { accountId: id } } });
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(d.painPoint).toBeTruthy();
      expect(d.useCase).toBeTruthy();
      expect((d.claimCheck as { supported: boolean }[]).every((c) => c.supported)).toBe(true);
    }
    expect(await db.researchQuery.count({ where: { accountId: id, cached: false } })).toBeGreaterThan(0);
  });

  it("re-running research inside the cache window spends no new searches", async () => {
    const id = await account("strong-cache.com");
    await runAccount(id);
    const paid = await db.researchQuery.count({ where: { accountId: id, cached: false } });
    await db.evidence.deleteMany({ where: { accountId: id } }); // force the questions to be asked again
    await runAccount(id, { fromStage: 5 });
    expect(await db.researchQuery.count({ where: { accountId: id, cached: false } })).toBe(paid);
    expect(await db.researchQuery.count({ where: { accountId: id, cached: true } })).toBeGreaterThan(0);
    expect(await db.evidence.count({ where: { accountId: id } })).toBeGreaterThan(0);
  });

  it("a claim the checker can't support is regenerated, then blocked for a person", async () => {
    const a = createMockAdapters();
    a.llm.checkClaims = async (claims) => claims.map((_, index) => ({ index, supported: false, reason: "Adds a number the fact does not state" }));
    setAdapters(a);
    const id = await account("strong-unsupported.com");
    await runAccount(id);
    const drafts = await db.draft.findMany({ where: { contact: { accountId: id } } });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.status === "blocked" && d.guardrailAttempts === 3)).toBe(true);
    expect(await db.reviewItem.count({ where: { type: "guardrail_failed", accountId: id } })).toBe(drafts.length);
  });

  it("if the checker is down, even a T3 draft goes to a person", async () => {
    const a = createMockAdapters();
    a.llm.checkClaims = async () => {
      throw new Error("OpenRouter 503");
    };
    setAdapters(a);
    const id = await account("strong-t3.com", [["Asha Mehta", "VP Data"]], { employees: 250, industry: "telecom", country: "US" });
    await db.account.update({ where: { id }, data: { tier: "T3", tierLocked: true } });
    const { SELLERS } = await import("@/lib/seller");
    const prev = SELLERS.manch.autonomy;
    SELLERS.manch.autonomy = "auto_t3";
    try {
      await runAccount(id);
    } finally {
      SELLERS.manch.autonomy = prev;
    }
    const drafts = await db.draft.findMany({ where: { contact: { accountId: id } } });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.status === "pending_review" && d.claimCheck === null)).toBe(true);
  });

  it("a failing brain falls back to rules instead of stalling the pipeline", async () => {
    const a = createMockAdapters();
    a.llm.planResearch = async () => {
      throw new Error("OpenRouter 429");
    };
    a.llm.accountBrief = async () => {
      throw new Error("bad JSON");
    };
    setAdapters(a);
    const id = await account("strong-fallback.com");
    expect((await runAccount(id)).status).toBe("done");
    expect((await db.researchPlan.findFirstOrThrow({ where: { accountId: id } })).planner).toBe("rules");
    expect((await db.accountBrief.findFirstOrThrow({ where: { accountId: id } })).model).toBe("rules");
    expect(await db.pipelineEvent.count({ where: { accountId: id, step: { in: ["brain.plan", "brain.brief"] }, outcome: "error" } })).toBe(2);
  });

  it("a second source for the same event corroborates it into a verified fact", async () => {
    const a = createMockAdapters();
    const base = a.llm.extractEvidence.bind(a.llm);
    a.llm.extractEvidence = async (pages, key, known = []) => {
      const out = await base(pages, key, known);
      // The follow-up page reports the event we already hold.
      return out.map((e) => (e.key === "trigger" && known.length ? { ...e, sameAsFactId: known[0].id } : e));
    };
    setAdapters(a);
    const id = await account("weak-then-found-corr.com");
    await runAccount(id);
    const triggers = await db.evidence.findMany({ where: { accountId: id, key: "trigger" }, orderBy: { createdAt: "asc" } });
    expect(triggers.length).toBe(2);
    expect(triggers[1].claim).toBe(triggers[0].claim);
    expect(triggers.every((t) => t.status === "verified")).toBe(true);
    expect(await db.pipelineEvent.count({ where: { accountId: id, step: "brain.corroborate", outcome: "pass" } })).toBe(1);
  });

  it("marking a fact wrong makes it unusable and withdraws drafts that cite it", async () => {
    const id = await account("strong-flag.com");
    await runAccount(id);
    const draft = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id }, status: "pending_review" } });
    const factId = (draft.claims as { factIds: string[] }[])[0].factIds[0];
    const r = await flagFact(factId, "This was a different company");
    expect(r.withdrawn).toBeGreaterThan(0);
    expect((await db.draft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("rejected");
    expect((await db.evidence.findUniqueOrThrow({ where: { id: factId } })).status).toBe("invalid");
    // Re-running the twin must not resurrect it.
    await runAccount(id, { fromStage: 7 });
    expect((await db.evidence.findUniqueOrThrow({ where: { id: factId } })).status).toBe("invalid");
    const stats = await computeStats();
    expect(stats.facts.flagged).toBe(1);
  });

  it("generates insights and feeds messaging learnings back", async () => {
    const id = await account("strong-insight.com");
    await runAccount(id);
    const i = await generateInsights();
    expect(i.model).toBe("mock");
    expect(i.headline.length).toBeGreaterThan(0);
    expect(i.stats.research.length).toBeGreaterThan(0);
    expect(Array.isArray(await latestLearnings())).toBe(true);
  });
});
