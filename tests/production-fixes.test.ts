// Regressions from production: the writer citing the seller's pitch as a fact, and the market scan
// running past the request limit.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { newContext } from "@/lib/pipeline/context";
import type { Adapters, DraftInput } from "@/lib/adapters/types";

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

describe("production regressions", () => {
  it("a seller-pitch sentence 'cited' as a fact no longer fails the draft; a real prospect claim still needs a fact", async () => {
    const base = createMockAdapters();
    const realDraft = base.llm.draft.bind(base.llm);
    const llm = Object.assign(Object.create(Object.getPrototypeOf(base.llm)), base.llm, {
      draft: async (input: DraftInput, attempt: number) => {
        const out = await realDraft(input, attempt);
        return { ...out, claims: [...out.claims, { text: "We help teams onboard vendors in hours.", factIds: ["approved pitch"] }] };
      },
    });
    setAdapters({ ...base, llm } as Adapters);
    const r = await ingestRows([{ company: "strong-acme", domain: "strong-acme.com", industry: "fmcg", employees: 1500, country: "IN", contactName: "Asha Mehta", title: "VP Data", email: "asha.mehta@strong-acme.com" }], { source: "test" });
    await runAccount(r.accountIds[0]);
    const drafts = await db.draft.findMany({ where: { contact: { accountId: r.accountIds[0] } } });
    expect(drafts.length).toBeGreaterThan(0);
    const claims = drafts[0].claims as { factIds: string[] }[];
    expect(claims.some((c) => c.factIds.includes("approved pitch"))).toBe(false);
    const blocked = await db.pipelineEvent.count({ where: { accountId: r.accountIds[0], step: "draft_review.fact_guardrail", reason: { contains: "approved pitch" } } });
    expect(blocked).toBe(0);
  });

  it("the market scan stops starting searches when its time budget is spent, and still records the scan", async () => {
    const { scanMarket } = await import("@/lib/discover/scan");
    const base = createMockAdapters();
    let calls = 0;
    const slow = { ...base, research: { ...base.research, search: async (...a: Parameters<typeof base.research.search>) => { if (String(a[2]).startsWith("market")) calls++; await new Promise((r) => setTimeout(r, 30)); return base.research.search(...a); } } } as Adapters;
    setAdapters(slow);
    const r = await scanMarket(newContext(), { budgetMs: 1 });
    expect(r.searches).toBe(3); // one batch of three, then the budget stops it
    expect(calls).toBe(3); // market searches only (firmographics lookups for candidates come after)
    expect(await db.pipelineEvent.count({ where: { step: "discover.search", reason: { startsWith: "Time budget reached" } } })).toBe(1);
  });
});
