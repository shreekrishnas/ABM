import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { acquireLease, drainOnce, QUEUE_LEASE, queueStatus, releaseLease, shouldContinue } from "@/lib/queue/drain";

async function reset() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) {
    await db.sequence.create({ data: { name: `${tier}`, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
  }
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ company: `Queue Co ${i}`, domain: `strong-queue${i}.com`, industry: "fmcg", employees: "800", country: "IN", contactName: `Person ${i}`, email: `person${i}@strong-queue${i}.com`, title: "VP Data" }));

beforeAll(() => setAdapters(createMockAdapters()));
beforeEach(reset);

describe("job lease", () => {
  it("only one holder at a time; a released or expired lease can be taken", async () => {
    const t0 = new Date("2026-10-09T10:00:00Z");
    expect(await acquireLease(QUEUE_LEASE, "a", 60_000, t0)).toBe(true);
    expect(await acquireLease(QUEUE_LEASE, "b", 60_000, t0)).toBe(false);
    // The holder can renew its own lease.
    expect(await acquireLease(QUEUE_LEASE, "a", 60_000, t0)).toBe(true);
    // Expired (a crashed worker): the next one takes over.
    expect(await acquireLease(QUEUE_LEASE, "b", 60_000, new Date(t0.getTime() + 61_000))).toBe(true);
    await releaseLease(QUEUE_LEASE, "b", { processed: 1, remaining: 0 }, new Date(t0.getTime() + 62_000));
    expect(await acquireLease(QUEUE_LEASE, "c", 60_000, new Date(t0.getTime() + 63_000))).toBe(true);
  });

  it("releasing only works for the current holder", async () => {
    const now = new Date();
    await acquireLease(QUEUE_LEASE, "a", 60_000, now);
    await releaseLease(QUEUE_LEASE, "someone-else", { processed: 0, remaining: 0 }, now);
    expect(await acquireLease(QUEUE_LEASE, "b", 60_000, now)).toBe(false);
  });
});

describe("queue drain", () => {
  it("is idle when nothing is queued", async () => {
    expect(await drainOnce()).toEqual({ status: "idle", processed: 0, remaining: 0 });
  });

  it("works through queued companies and records the run", async () => {
    await ingestRows(rows(3), { source: "csv" });
    expect((await queueStatus()).queued).toBe(3);
    const r = await drainOnce({ budgetMs: 60_000 });
    expect(r).toMatchObject({ status: "drained", processed: 3, remaining: 0 });
    expect(shouldContinue(r)).toBe(false);
    const s = await queueStatus();
    expect(s).toMatchObject({ queued: 0, working: false, lastProcessed: 3 });
    expect(s.lastRunAt).not.toBeNull();
    expect(await db.account.count({ where: { pipelineStatus: "queued" } })).toBe(0);
  });

  it("stops at the slice budget and asks to continue", async () => {
    await ingestRows(rows(3), { source: "csv" });
    // processQueue checks the deadline before each company, so a 1 ms slice processes at most one.
    const r = await drainOnce({ budgetMs: 1 });
    expect(r.processed).toBeLessThanOrEqual(1);
    expect(r.status).toBe("drained");
    expect(r.remaining).toBeGreaterThan(0);
    expect(shouldContinue(r)).toBe(r.processed > 0);
  });

  it("a second worker backs off while the first holds the lease", async () => {
    await ingestRows(rows(1), { source: "csv" });
    await acquireLease(QUEUE_LEASE, "other-worker", 60_000);
    expect(await drainOnce()).toEqual({ status: "busy", processed: 0, remaining: 1 });
    expect((await queueStatus()).working).toBe(true);
  });
});
