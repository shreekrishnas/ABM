// Daily pipeline → research queue reliability. In production the daily check's last hand-off (to the
// research queue) failed every day with no reason recorded, and while AI was paused the queue ran
// "0 done, 411 waiting" without saying why. These cover the fixes, on the test database with mocked
// AI (nothing paid, nothing sent): the queue route answers at once, a refused hand-off is classified
// and recorded and the last step works a slice itself, idle slices say why, abandoned jobs get an
// outcome, and the alerts name the cause.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const pending: (() => unknown)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { pending.push(fn); } }));
vi.mock("@/lib/queue/drain", async (orig) => {
  const real = await orig<typeof import("@/lib/queue/drain")>();
  return { ...real, queueStatus: vi.fn(real.queueStatus) };
});

import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { ingestRows } from "@/lib/pipeline/ingest";
import { setAdapters } from "@/lib/adapters";
import { createMockAdapters } from "@/lib/adapters/mock";
import { setAiPaused } from "@/lib/admin/ai-pause";
import { recordRun } from "@/lib/admin/ops";
import { recordError } from "@/lib/admin/errors";
import { chainAlerts, queueAlerts } from "@/lib/admin/alerts";
import { QUEUE_LEASE, acquireLease, drainOnce, queueStatus, startDrain } from "@/lib/queue/drain";
import { continueChain, type ChainDeps } from "@/lib/pipeline/daily-chain";
import { sweepStaleJobs } from "@/lib/jobs";
import { POST as queuePost } from "@/app/api/v1/queue/route";

const KEY = "queue-test-key";
const prev = { key: process.env.ABM_API_KEY, app: process.env.APP_URL };
const realFetch = globalThis.fetch;
beforeAll(() => { setAdapters(createMockAdapters()); process.env.ABM_API_KEY = KEY; delete process.env.APP_URL; });
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [["ABM_API_KEY", prev.key], ["APP_URL", prev.app]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.mailbox.create({ data: { address: "out@company.test", dailyCap: 40 } });
  for (const tier of ["T1", "T2", "T3"] as const) await db.sequence.create({ data: { name: tier, tier, steps: { create: [{ order: 1, channel: "email", dayOffset: 0, instruction: "Lead" }] } } });
  pending.length = 0;
  globalThis.fetch = realFetch;
});

const queueCompanies = (n: number) =>
  ingestRows(Array.from({ length: n }, (_, i) => ({ company: `Waiting Co ${i}`, domain: `strong-waiting${i}.com`, industry: "fmcg", employees: "800", country: "IN", contactName: `Person ${i}`, email: `person${i}@strong-waiting${i}.com`, title: "VP Data" })), { source: "csv" });
const queued = () => db.account.count({ where: { pipelineStatus: "queued" } });
const post = (auth = true) => queuePost(new Request("https://abm.test/api/v1/queue", { method: "POST", headers: auth ? { authorization: `Bearer ${KEY}`, "x-abm-run-id": "run_queue1234" } : {} }));
const runAfter = async () => { while (pending.length) await pending.shift()!(); };

describe("the queue route answers at once and says why when it can't", () => {
  it("refuses a call without the secret", async () => {
    expect((await post(false)).status).toBe(401);
  });

  it("idle when nothing is queued or running; busy while another worker holds the queue", async () => {
    expect(await (await post()).json()).toMatchObject({ status: "idle" });
    await queueCompanies(1);
    await acquireLease(QUEUE_LEASE, "someone-else", 60_000);
    const busy = await post();
    expect(busy.status).toBe(200);
    expect(await busy.json()).toMatchObject({ status: "busy", queued: 1 });
    expect(pending).toHaveLength(0);
  });

  it("answers 202 before any work; cut-off runs are put back and worked after the answer", async () => {
    await queueCompanies(2);
    // One company was cut off mid-run two hours ago (a timed-out request): only it, nothing queued.
    const [a, b] = await db.account.findMany({ orderBy: { name: "asc" } });
    await db.account.update({ where: { id: a.id }, data: { pipelineStatus: "running", lastRunAt: new Date(Date.now() - 2 * 3_600_000) } });
    await db.account.update({ where: { id: b.id }, data: { pipelineStatus: "done" } });
    const res = await post();
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "started" });
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).pipelineStatus).toBe("running"); // nothing done before answering
    await runAfter();
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).pipelineStatus).not.toMatch(/^(running|queued)$/);
    const slice = await baseDb.runLog.findFirstOrThrow({ where: { job: "Research queue" } });
    expect(slice.processed).toBeGreaterThan(0);
    expect(slice.note).toMatch(/run=run_queue1234/);
  });

  it("a failure before answering comes back as a reason, not a bare error", async () => {
    vi.mocked(queueStatus).mockRejectedValueOnce(new Error("database unavailable"));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "queue_failed", message: "database unavailable" });
  });
});

describe("a slice that does nothing says why", () => {
  it("while AI is paused: nothing runs, everything stays queued, and the run log says AI is paused", async () => {
    await queueCompanies(3);
    await setAiPaused(true, "ops@trilliantdigital.com");
    const r = await drainOnce({ runId: "run_paused123" });
    expect(r).toMatchObject({ status: "drained", processed: 0, remaining: 3, reason: "AI is paused" });
    expect(await queued()).toBe(3);
    expect((await baseDb.runLog.findFirstOrThrow({ where: { job: "Research queue" } })).note).toBe("waiting: AI is paused · run=run_paused123");
    await setAiPaused(false, "ops@trilliantdigital.com");
  });
});

describe("starting the queue: the answer is read like any hand-off", () => {
  const answer = (status: number, body: string, type = "text/plain") => { globalThis.fetch = (async () => new Response(body, { status, headers: { "content-type": type } })) as typeof fetch; };
  it("the platform's loop limit (508), a protection page, and an accepted start", async () => {
    answer(508, "INFINITE_LOOP_DETECTED");
    expect(await startDrain("https://abm.test", "run_abcdef")).toMatchObject({ ok: false, outcome: "loop", status: 508, host: "abm.test", attempts: 1 });
    answer(401, "<html>Authentication Required · Vercel</html>", "text/html");
    expect(await startDrain("https://abm.test")).toMatchObject({ ok: false, outcome: "protected", status: 401 });
    answer(202, JSON.stringify({ status: "started" }), "application/json");
    expect(await startDrain("https://abm.test")).toMatchObject({ ok: true, outcome: "accepted", status: 202 });
    expect(await startDrain("")).toMatchObject({ ok: false, detail: expect.stringMatching(/APP_URL/) });
  });
});

describe("the daily check's last step when the queue hand-off is refused (the production failure)", () => {
  it("works one slice of the queue itself (mocked AI), records the refusal with its status, and the alert explains it", async () => {
    await queueCompanies(3);
    const d: ChainDeps = {
      runTick: async () => ({}),
      claim: async () => ({ ok: true }),
      finish: async () => undefined,
      record: (job, t, r) => recordRun(job, t, r),
      recordError,
      aiPaused: async () => false,
      handOff: async () => ({ ok: true, outcome: "accepted", status: 202, host: "abm.test", attempts: 1, ms: 1 }),
      startQueue: async () => ({ ok: false, outcome: "loop", status: 508, host: "abm.test", attempts: 1, ms: 30, detail: "The hosting platform refused another call of the app to itself (loop protection)" }),
      drainHere: async (runId) => { const r = await drainOnce({ runId, budgetMs: 30_000 }); return { processed: r.processed, remaining: r.remaining, reason: r.reason }; },
    };
    const before = await queued();
    await continueChain("agent", "run_chain12345", "https://abm.test", d);
    expect(await queued()).toBeLessThan(before);
    const handoff = await baseDb.runLog.findFirstOrThrow({ where: { job: "Daily check · handoff" } });
    expect(handoff.ok).toBe(false);
    expect(handoff.note).toMatch(/^→ queue loop 508 host=abm\.test attempts=1 run=run_chain12345: .*; ran one slice here instead: [1-9]\d* done, \d+ waiting$/);
    expect((await baseDb.runLog.findFirstOrThrow({ where: { job: "Research queue" } })).note).toMatch(/run=run_chain12345/);
    // The chain alert (45 minutes after core) names the cause and that the slice ran here.
    await baseDb.runLog.create({ data: { job: "Daily check", startedAt: new Date(Date.now() - 2 * 3_600_000), ok: true } });
    for (const s of ["intel", "intent", "market", "agent"]) await baseDb.runLog.create({ data: { job: `Daily check · ${s}`, startedAt: new Date(Date.now() - 3_600_000), ok: true } });
    const [alert] = await chainAlerts();
    expect(alert).toMatchObject({ key: "chain_broken", tone: "warn", title: "The daily check couldn't start the research queue on its own" });
    expect(alert.fix).toMatch(/five calls in a row/);
  }, 60_000);
});

describe("background jobs always get an outcome", () => {
  it("a job cut off by the time limit, or never started, is saved as failed with the reason; others are untouched", async () => {
    const old = new Date(Date.now() - 20 * 60_000);
    const mk = (status: string, at: Date, startedAt: Date | null = null) => baseDb.backgroundJob.create({ data: { kind: "run_account", sellerId: "manch", label: "Research", status, createdAt: at, startedAt } });
    await baseDb.client.create({ data: { id: "manch", name: "Manch" } }).catch(() => undefined);
    const cut = await mk("running", old, old);
    const never = await mk("queued", old);
    const fresh = await mk("running", new Date(), new Date());
    const done = await mk("done", old, old);
    expect(await sweepStaleJobs()).toBe(2);
    const get = (id: string) => baseDb.backgroundJob.findUniqueOrThrow({ where: { id } });
    expect(await get(cut.id)).toMatchObject({ status: "failed", message: expect.stringMatching(/^Cut off/) });
    expect(await get(never.id)).toMatchObject({ status: "failed", message: expect.stringMatching(/^Didn't start/) });
    expect((await get(fresh.id)).status).toBe("running");
    expect((await get(done.id)).status).toBe("done");
    expect(await sweepStaleJobs()).toBe(0); // running it again changes nothing
  });
});

describe("the research-queue alert names the cause", () => {
  it("AI paused: says so and how to resume; AI on and nothing researched for a day: the queue isn't moving", async () => {
    expect(await queueAlerts()).toEqual([]);
    await queueCompanies(2);
    await setAiPaused(true, "ops@trilliantdigital.com");
    const [paused] = await queueAlerts();
    expect(paused).toMatchObject({ key: "queue_waiting", tone: "warn", title: "2 companies are waiting for research: AI is paused" });
    expect(paused.fix).toMatch(/resume AI/);
    await setAiPaused(false, "ops@trilliantdigital.com");
    await db.account.updateMany({ data: { lastRunAt: new Date(Date.now() - 2 * 86_400_000) } });
    const [stuck] = await queueAlerts();
    expect(stuck).toMatchObject({ key: "queue_waiting", tone: "bad", title: "The research queue isn't moving: 2 companies waiting" });
    await db.account.updateMany({ data: { lastRunAt: new Date() } });
    expect(await queueAlerts()).toEqual([]);
  });
});
