import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows, importChunk, startBatch, finishBatch } from "@/lib/pipeline/ingest";
import { processQueue } from "@/lib/pipeline/orchestrator";
import { analyzeHeaders, validateRow } from "@/lib/import/fields";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { sha256 } from "@/lib/pipeline/crypto";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) {
    await db.sequence.create({ data: { name: `${tier}`, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
  }
}

// A weekly file as a sales-ops person would export it.
const week1 = [
  { "Company Name": "Acme Analytics", Website: "https://www.strong-acme.com/", Industry: "analytics", Headcount: "800", Country: "United States", Name: "Asha Mehta", "Work Email": "asha.mehta@strong-acme.com", "Job Title": "VP Data", "Internal Notes": "met at conf" },
  { "Company Name": "Acme Analytics", Website: "strong-acme.com", Industry: "", Headcount: "", Country: "", Name: "Daniel Okafor", "Work Email": "daniel.okafor@strong-acme.com", "Job Title": "Head of Data Platform", "Internal Notes": "" },
];

beforeAll(() => setAdapters(createMockAdapters()));
beforeEach(reset);

describe("template validation", () => {
  it("maps loose headers, ignores columns outside the template, flags missing required ones", () => {
    const a = analyzeHeaders(["Company Name", "Website", "Work Email", "Internal Notes", "Favourite colour"]);
    expect(Object.values(a.mapping).sort()).toEqual(["company", "domain", "email"]);
    expect(a.ignored).toEqual(["Internal Notes", "Favourite colour"]);
    expect(analyzeHeaders(["Company", "Email"]).missingRequired.map((f) => f.key)).toEqual(["domain"]);
  });

  it("rejects rows with invalid values and explains why", () => {
    const { mapping } = analyzeHeaders(["Company", "Domain", "Email", "Employees", "Country", "Phone"]);
    const bad = validateRow({ Company: "X", Domain: "not a domain", Email: "a@@b", Employees: "lots", Country: "Narnia", Phone: "12" }, mapping);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toMatch(/Domain/);
      expect(bad.error).toMatch(/Email/);
      expect(bad.error).toMatch(/Employees/);
      expect(bad.error).toMatch(/Country/);
      expect(bad.error).toMatch(/Phone/);
    }
    const good = validateRow({ Company: "X", Domain: "x.com", Email: "A@X.com", Employees: "200-400", Country: "india", Phone: "+91 98765 43210" }, mapping);
    expect(good.ok && good.row).toMatchObject({ domain: "x.com", email: "a@x.com", employees: 300, country: "IN", phone: "+919876543210" });
  });
});

describe("weekly re-uploads", () => {
  it("re-uploading the same file creates no duplicates and queues nothing", async () => {
    const first = await ingestRows(week1, { source: "csv", filename: "week1.csv" });
    expect(first.accepted).toBe(2);
    expect(await db.account.count()).toBe(1);
    expect(await db.contact.count()).toBe(2);
    await processQueue({});
    // The pipeline may add people it discovered (stage 8); count after processing.
    const contactsBefore = await db.contact.count();
    const runsBefore = await db.pipelineEvent.count({ where: { step: "orchestrator.stop" } }) + await db.ledgerEntry.count();

    const again = await ingestRows(week1, { source: "csv", filename: "week1-again.csv" });
    expect(again.accepted).toBe(2);
    expect(await db.account.count()).toBe(1);
    expect(await db.contact.count()).toBe(contactsBefore);
    expect(await db.account.count({ where: { pipelineStatus: "queued" } })).toBe(0);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: again.batchId } });
    expect(batch.stats).toMatchObject({ accountsUnchanged: 1, contactsUnchanged: 2, contactsCreated: 0 });
    expect(batch.ignoredColumns).toEqual(["Internal Notes"]);
    await processQueue({});
    expect(await db.pipelineEvent.count({ where: { step: "orchestrator.stop" } }) + await db.ledgerEntry.count()).toBe(runsBefore);
  });

  it("changes update the record, reset only the changed field, and queue a re-run", async () => {
    await ingestRows(week1, { source: "csv", filename: "week1.csv" });
    await processQueue({});
    const asha = await db.contact.findFirstOrThrow({ where: { email: "asha.mehta@strong-acme.com" } });
    const emailBefore = await db.fieldState.findFirstOrThrow({ where: { contactId: asha.id, field: "email" } });

    const week2 = [{ ...week1[0], "Job Title": "Chief Data Officer", Headcount: "950" }, { ...week1[1], Name: "Lena Fischer", "Work Email": "lena.fischer@strong-acme.com", "Job Title": "Director of Engineering" }];
    const res = await ingestRows(week2, { source: "csv", filename: "week2.csv" });
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: res.batchId } });
    expect(batch.stats).toMatchObject({ accountsUpdated: 1, contactsUpdated: 1, contactsCreated: 1 });

    const acc = await db.account.findFirstOrThrow();
    expect(acc.employees).toBe(950);
    expect(acc.pipelineStatus).toBe("queued");
    const ashaAfter = await db.contact.findUniqueOrThrow({ where: { id: asha.id } });
    expect(ashaAfter.title).toBe("Chief Data Officer");
    expect((await db.fieldState.findFirstOrThrow({ where: { contactId: asha.id, field: "title" } })).status).toBe("unknown");
    // Unchanged email keeps its verified status.
    expect((await db.fieldState.findFirstOrThrow({ where: { contactId: asha.id, field: "email" } })).status).toBe(emailBefore.status);

    const q = await processQueue({ batchId: res.batchId });
    expect(q.remaining).toBe(0);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: res.batchId } })).status).toBe("done");
    expect((await db.fieldState.findFirstOrThrow({ where: { contactId: asha.id, field: "title" } })).status).not.toBe("unknown");
  });

  it("blank cells never erase existing data", async () => {
    await ingestRows(week1, { source: "csv", filename: "week1.csv" });
    await ingestRows([{ "Company Name": "Acme Analytics", Website: "strong-acme.com", Industry: "", Headcount: "", Country: "" }], { source: "csv", filename: "sparse.csv" });
    const acc = await db.account.findFirstOrThrow();
    expect(acc.industry).toBe("analytics");
    expect(acc.employees).toBe(800);
    expect(acc.country).toBe("US");
  });

  it("chunked uploads report spreadsheet row numbers and never import erased people", async () => {
    await db.suppression.create({ data: { value: `sha256:${sha256("erased.person@strong-acme.com")}`, reason: "erasure" } });
    const headers = ["Company", "Domain", "Contact Name", "Email"];
    const batch = await startBatch({ filename: "big.csv", source: "csv", rows: 3 });
    const { mapping } = analyzeHeaders(headers);
    await importChunk(batch.id, [{ Company: "Acme", Domain: "strong-acme.com", "Contact Name": "Ok Person", Email: "ok.person@strong-acme.com" }], 0, mapping);
    const r2 = await importChunk(batch.id, [{ Company: "Acme", Domain: "strong-acme.com", "Contact Name": "Erased Person", Email: "erased.person@strong-acme.com" }, { Company: "", Domain: "x.com" }], 1, mapping);
    expect(r2.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(await db.contact.count({ where: { email: "erased.person@strong-acme.com" } })).toBe(0);
    const fin = await finishBatch(batch.id);
    expect(fin.accepted).toBe(2);
    expect(fin.rejected).toBe(1);
    expect(fin.status).toBe("processing");
  });

  it("accounts owned by sales are updated but not re-run", async () => {
    await ingestRows(week1, { source: "csv", filename: "week1.csv" });
    await processQueue({});
    const acc = await db.account.findFirstOrThrow();
    await db.account.update({ where: { id: acc.id }, data: { stage: "OPPORTUNITY" } });
    const drafts = await db.draft.count();
    await ingestRows([{ ...week1[0], "Job Title": "CDO" }], { source: "csv", filename: "w3.csv" });
    await processQueue({});
    expect(await db.draft.count()).toBe(drafts);
    expect((await db.account.findFirstOrThrow()).stage).toBe("OPPORTUNITY");
  });
});
