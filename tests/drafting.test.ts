// Drafting: the brief reaches the writer, the writer model writes while the regular model checks,
// our own sentences don't hold a draft, an uncited prospect claim still does, and rewrites get fix instructions.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import type { Adapters, DraftInput } from "@/lib/adapters/types";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
}
beforeEach(reset);

const company = (name: string) => [{ company: name, domain: `${name}.com`, industry: "fmcg", employees: 1500, country: "IN", contactName: "Asha Mehta", title: "VP Data", email: `asha.mehta@${name}.com` }];

/** Stand-in services with a separate writer that records what it was given and can add sentences. */
function withWriter(extra: (input: DraftInput, attempt: number) => { text: string; factIds: string[] }[] = () => []) {
  const base = createMockAdapters();
  const inputs: DraftInput[] = [];
  let llmDrafts = 0;
  const llm = Object.assign(Object.create(Object.getPrototypeOf(base.llm)), base.llm, { draft: async () => { llmDrafts++; throw new Error("the main AI must not write emails when a writer is set"); } });
  const writer = {
    draft: async (input: DraftInput, attempt: number) => {
      inputs.push(input);
      const out = await base.llm.draft(input, attempt);
      return { ...out, claims: [...out.claims, ...extra(input, attempt)] };
    },
  };
  setAdapters({ ...base, llm, writer } as Adapters);
  return { inputs, llmDrafts: () => llmDrafts };
}

describe("drafting with a brief and a writer model", () => {
  it("the writer writes from a brief led by the strongest trigger; the brief is saved with the draft", async () => {
    const w = withWriter();
    const r = await ingestRows(company("strong-brief"), { source: "test" });
    await runAccount(r.accountIds[0]);
    expect(w.llmDrafts()).toBe(0);
    expect(w.inputs.length).toBeGreaterThan(0);
    const brief = w.inputs[0].brief!;
    expect(brief.whyNow.factId).toBe(w.inputs[0].facts[0].id);
    const draft = await db.draft.findFirstOrThrow({ where: { contact: { accountId: r.accountIds[0] } } });
    expect((draft.brief as { whyNow: { factId: string } }).whyNow.factId).toBe(brief.whyNow.factId);
  });

  it("an uncited sentence about us doesn't hold the draft (the Aurobindo case)", async () => {
    withWriter(() => [{ text: "Manch verifies PAN, GSTIN and bank accounts in real time.", factIds: [] }]);
    const r = await ingestRows(company("strong-ours"), { source: "test" });
    await runAccount(r.accountIds[0]);
    const draft = await db.draft.findFirstOrThrow({ where: { contact: { accountId: r.accountIds[0] } } });
    expect(draft.status).not.toBe("blocked");
    expect((draft.claims as { text: string }[]).some((c) => c.text.startsWith("Manch verifies"))).toBe(false);
  });

  it("an uncited sentence about the prospect still holds the draft, and the rewrite is told which facts it may cite", async () => {
    const w = withWriter(() => [{ text: "Your vendor master is full of duplicates.", factIds: [] }]);
    const r = await ingestRows(company("strong-uncited"), { source: "test" });
    await runAccount(r.accountIds[0]);
    const draft = await db.draft.findFirstOrThrow({ where: { contact: { accountId: r.accountIds[0] } } });
    expect(draft.status).toBe("blocked");
    const rewrite = w.inputs.find((i) => i.revise);
    expect(rewrite?.revise?.issues.join(" ")).toMatch(/cite one of these fact ids/);
  });
});
