import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { hashEmbed } from "@/lib/adapters/hash-embedder";
import { clearSellerOverrides, loadSeller } from "@/lib/seller";
import { chunkDocument } from "@/lib/knowledge/rag/chunk";
import { builtInCorpus } from "@/lib/knowledge/rag/corpus";
import { addDocument, deleteDocument, ensureIndexed, forgetSync, syncBuiltIns } from "@/lib/knowledge/rag/store";
import { clearRetrievalCache, retrieve } from "@/lib/knowledge/rag/retrieve";
import { ingestRows } from "@/lib/pipeline/ingest";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { newContext } from "@/lib/pipeline/context";
import { recordReply, sendApproved } from "@/lib/pipeline/stages/engagement";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) {
    await db.sequence.create({ data: { name: `${tier}`, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead with trigger" }] } } });
  }
  clearSellerOverrides();
  forgetSync();
  clearRetrievalCache();
}

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

beforeAll(() => setAdapters(createMockAdapters()));
beforeEach(reset);

describe("chunking", () => {
  it("splits on headings, keeps chunks near the target size, and prefixes title and heading", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i} about vendor onboarding and GST checks for distributors.`).join(" ");
    const chunks = chunkDocument("HCCB case study", `Intro paragraph.\n\n# Problem\n${long}\n\n${long}\n\n# Result\nOnboarding fell from 7 days to 7 hours.`);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0].text.startsWith("HCCB case study\n")).toBe(true);
    expect(chunks.some((c) => c.text.startsWith("HCCB case study › Problem\n"))).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ heading: "Result" });
    for (const c of chunks) expect(c.text.split(/\s+/).length).toBeLessThan(400);
  });

  it("the offline embedder puts related text closer than unrelated text", () => {
    const q = hashEmbed("vendor master duplicates and GST mismatches");
    expect(cos(q, hashEmbed("Duplicate vendors and GSTIN mismatch in the vendor master"))).toBeGreaterThan(cos(q, hashEmbed("Rider onboarding for a food delivery network")));
  });
});

describe("indexing", () => {
  it("indexes the built-in corpus once; re-syncing re-embeds only what changed", async () => {
    const sp = structuredClone(loadSeller("manch").pack);
    const first = await syncBuiltIns(sp);
    expect(first.embedded).toBe(builtInCorpus(sp).length);
    expect(await db.knowledgeChunk.count()).toBeGreaterThanOrEqual(first.docs);
    expect((await syncBuiltIns(sp)).embedded).toBe(0);
    sp.writing!.objections[0].answer = "A new answer for this test.";
    expect((await syncBuiltIns(sp)).embedded).toBe(1);
    sp.writing!.objections.pop();
    expect((await syncBuiltIns(sp)).removed).toBe(1);
  });

  it("retrieves the objection that matches what a prospect said", async () => {
    await ensureIndexed(loadSeller("manch").pack);
    const hits = await retrieve({ sellerId: "manch", query: "We already have SAP MDG for master data", kinds: ["objection"], k: 1 });
    expect(hits[0].title).toMatch(/already have SAP MDG/);
  });

  it("an added document is found, filtered by kind, and can be removed", async () => {
    await ensureIndexed(loadSeller("manch").pack);
    const { id, chunks } = await addDocument({ sellerId: "manch", title: "Call notes: Ganga Dairy", text: "The procurement head said duplicate vendor codes across 14 plants caused failed payments last quarter. They want GSTIN checks at vendor registration.", kind: "document", approved: false });
    expect(chunks).toBe(1);
    const hits = await retrieve({ sellerId: "manch", query: "duplicate vendor codes failed payments plants", k: 3 });
    expect(hits[0]).toMatchObject({ title: "Call notes: Ganga Dairy", origin: "upload", approved: false });
    expect(await retrieve({ sellerId: "manch", query: "duplicate vendor codes failed payments plants", kinds: ["objection"], k: 3 })).not.toContainEqual(expect.objectContaining({ title: "Call notes: Ganga Dairy" }));
    await deleteDocument(id);
    expect((await retrieve({ sellerId: "manch", query: "duplicate vendor codes failed payments plants", k: 3 })).map((h) => h.title)).not.toContain("Call notes: Ganga Dairy");
  });

  it("built-in documents can't be deleted from the app", async () => {
    await ensureIndexed(loadSeller("manch").pack);
    const builtIn = await db.knowledgeDoc.findFirstOrThrow({ where: { origin: "built_in" } });
    await expect(deleteDocument(builtIn.id)).rejects.toThrow(/Built-in/);
  });
});

describe("drafting with the knowledge base", () => {
  async function company() {
    const r = await ingestRows([{ company: "Strong Rag Foods", domain: "strong-rag.com", industry: "fmcg", employees: 1500, country: "IN", contactName: "Meera Rao", title: "Chief Procurement Officer", email: "meera.rao@strong-rag.com" }], { source: "test" });
    return r.accountIds[0];
  }

  it("each draft records the knowledge it used, and the run log says what was retrieved", async () => {
    const id = await company();
    await runAccount(id);
    const d = await db.draft.findFirstOrThrow({ where: { contact: { accountId: id } } });
    const k = d.knowledge as { play: string; references: string[] };
    expect(k.play).toBe("email_first");
    expect(k.references.length).toBeGreaterThan(0);
    expect(await db.knowledgeChunk.count({ where: { id: { in: k.references } } })).toBe(k.references.length);
    const ev = await db.pipelineEvent.findFirstOrThrow({ where: { accountId: id, step: "draft_review.knowledge" } });
    expect(ev.outcome).toBe("pass");
  });

  it("an email that gets a positive reply becomes a learned example", async () => {
    const id = await company();
    await runAccount(id);
    await db.draft.updateMany({ where: { status: "pending_review" }, data: { status: "approved" } });
    await sendApproved(newContext());
    // The buying group may include people the pipeline added; reply as one who was emailed.
    const c = await db.contact.findFirstOrThrow({ where: { accountId: id, messages: { some: { status: "delivered" } } } });
    expect(await recordReply(c.id, "Interested, let's talk next week")).toBe("positive");
    const learned = await db.knowledgeDoc.findFirstOrThrow({ where: { origin: "learned" } });
    expect(learned).toMatchObject({ kind: "example" });
    expect((learned.tags as { plays?: string[] }).plays).toEqual(["email_first"]);
    expect(learned.text).not.toMatch(/unsubscribe/);
    const hits = await retrieve({ sellerId: "manch", query: learned.text.slice(0, 200), kinds: ["example"], k: 3 });
    expect(hits.map((h) => h.origin)).toContain("learned");
  });
});
