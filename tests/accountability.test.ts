// Who brought each company in, how, from what, and who approved it.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { newContext } from "@/lib/pipeline/context";
import { draftDiscovery, runDiscovery } from "@/lib/discover/describe";
import { findLookalikes, processLookalikeQueue } from "@/lib/discover/lookalike";
import { addSuggestion } from "@/lib/discover/scan";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

beforeEach(async () => {
  setAdapters(createMockAdapters());
  await reset();
});

describe("originator and owner", () => {
  it("an upload records who uploaded it and the file; a re-upload by someone else doesn't rewrite the origin", async () => {
    const r = await ingestRows([{ company: "Acme Foods", domain: "acmefoods.in", country: "IN" }], { source: "csv", filename: "Q4 targets.csv", createdBy: "asha@trilliant.test" });
    const a = await db.account.findUniqueOrThrow({ where: { id: r.accountIds[0] } });
    expect([a.addedBy, a.addedVia, a.originDetail, a.approvedBy]).toEqual(["asha@trilliant.test", "csv", "Q4 targets.csv", null]);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: r.batchId } })).createdBy).toBe("asha@trilliant.test");
    await ingestRows([{ company: "Acme Foods", domain: "acmefoods.in", industry: "fmcg" }], { source: "csv", filename: "update.csv", createdBy: "ravi@trilliant.test" });
    const again = await db.account.findUniqueOrThrow({ where: { id: a.id } });
    expect([again.addedBy, again.originDetail]).toEqual(["asha@trilliant.test", "Q4 targets.csv"]);
  });

  it("an approved lookalike records who searched, the reference company and who approved it", async () => {
    await findLookalikes("parle.example.in", newContext(), "searcher@trilliant.test");
    await processLookalikeQueue({ budgetMs: 60_000, ctx: newContext() });
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { origin: "lookalike", researchStatus: "done", status: "new" } });
    expect(s.requestedBy).toBe("searcher@trilliant.test");
    const a = await db.account.findUniqueOrThrow({ where: { id: (await addSuggestion(s.id, "lead@trilliant.test"))! } });
    expect([a.addedBy, a.addedVia, a.approvedBy]).toEqual(["searcher@trilliant.test", "lookalike", "lead@trilliant.test"]);
    expect(a.originDetail).toMatch(/^Like /);
  });

  it("an approved company from a search records the search brief", async () => {
    const search = await draftDiscovery("Indian pharma companies with 5,000+ employees", "searcher@trilliant.test", newContext());
    await runDiscovery(search.id, newContext());
    await processLookalikeQueue({ budgetMs: 60_000, ctx: newContext() });
    const s = await db.prospectSuggestion.findFirstOrThrow({ where: { origin: "discovery", researchStatus: "done" } });
    const a = await db.account.findUniqueOrThrow({ where: { id: (await addSuggestion(s.id, "lead@trilliant.test"))! } });
    expect([a.addedBy, a.addedVia, a.approvedBy]).toEqual(["searcher@trilliant.test", "discovery", "lead@trilliant.test"]);
    expect(a.originDetail).toBe("Search: Indian pharma companies with 5,000+ employees");
  });
});
