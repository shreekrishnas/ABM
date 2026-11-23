// The whole daily chain through the real /api/v1/tick route, in-process: the scheduler's GET runs
// core, each hand-off's fetch is delivered straight to the route, `after()` work runs when the test
// drains it, and the step bodies are mocked (nothing paid, nothing sent). Uses the test database.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const pending: (() => unknown)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { pending.push(fn); } }));

const ran: string[] = [];
vi.mock("@/lib/pipeline/orchestrator", async (orig) => ({
  ...(await orig<typeof import("@/lib/pipeline/orchestrator")>()),
  tickStep: async (step: string) => { ran.push(step); return { step }; },
}));

const queueKicks: string[] = [];
let queueAnswer: { ok: boolean; outcome: string; status: number | null; detail?: string } = { ok: true, outcome: "accepted", status: 202 };
vi.mock("@/lib/queue/drain", async (orig) => ({
  ...(await orig<typeof import("@/lib/queue/drain")>()),
  startDrain: async (base: string, runId: string) => { queueKicks.push(`${base}|${runId}`); return { ...queueAnswer, host: new URL(base).host, attempts: 1, ms: 2 }; },
}));

import { GET, POST } from "@/app/api/v1/tick/route";
import { baseDb } from "@/lib/db-base";
import { chainAlerts } from "@/lib/admin/alerts";

const KEY = "test-key-123";
const APP = "https://abm.test";
type Responder = (url: string, init: RequestInit) => Promise<Response> | Response;
let respond: Responder;

async function drainAfter() {
  while (pending.length) await pending.shift()!();
}

const realFetch = globalThis.fetch;
const prev = { key: process.env.ABM_API_KEY, app: process.env.APP_URL, cron: process.env.CRON_SECRET };

beforeEach(async () => {
  process.env.ABM_API_KEY = KEY;
  process.env.APP_URL = APP;
  delete process.env.CRON_SECRET;
  ran.length = 0; queueKicks.length = 0; pending.length = 0;
  queueAnswer = { ok: true, outcome: "accepted", status: 202 };
  await baseDb.runLog.deleteMany({ where: { job: { startsWith: "Daily check" } } });
  await baseDb.jobLease.deleteMany({ where: { name: { startsWith: "tick:" } } });
  await (await import("@/lib/admin/ai-pause")).setAiPaused(false, "test");
  // By default every hand-off reaches the route itself, as on a correctly configured deployment.
  respond = (url, init) => POST(new Request(url, init));
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => respond(String(u), init ?? {})) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [["ABM_API_KEY", prev.key], ["APP_URL", prev.app], ["CRON_SECRET", prev.cron]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const cron = () => GET(new Request(`${APP}/api/v1/tick`, { headers: { authorization: `Bearer ${KEY}` } }));
const outcomes = async () => (await baseDb.runLog.findMany({ where: { job: { startsWith: "Daily check" } }, orderBy: { startedAt: "asc" } })).map((r) => ({ job: r.job, ok: r.ok, note: r.note ?? "" }));

describe("daily chain through the tick route", () => {
  it("runs core → intel → intent → market → agent → queue once, all tied by one run id", async () => {
    const res = await cron();
    expect(res.status).toBe(200);
    const { runId } = await res.json();
    expect(runId).toMatch(/^run_/);
    await drainAfter();

    expect(ran).toEqual(["core", "intel", "intent", "market", "agent"]);
    expect(queueKicks).toEqual([`${APP}|${runId}`]);
    const rows = await outcomes();
    for (const job of ["Daily check", "Daily check · intel", "Daily check · intent", "Daily check · market", "Daily check · agent"]) {
      expect(rows.find((r) => r.job === job)).toMatchObject({ ok: true });
      expect(rows.find((r) => r.job === job)?.note).toContain(`run=${runId}`);
      expect(rows.find((r) => r.job === `${job} · started`)?.note).toBe(`run=${runId}`);
    }
    expect(rows.some((r) => r.job === "Daily check · handoff")).toBe(false);
    expect(await chainAlerts(new Date(Date.now() + 60 * 60_000))).toEqual([]);
  });

  it("a second scheduler call the same day runs nothing again", async () => {
    await cron(); await drainAfter();
    ran.length = 0;
    const again = await cron();
    expect((await again.json()).status).toBe("skipped");
    await drainAfter();
    expect(ran).toEqual([]);
    // A retried hand-off to a finished step is skipped too.
    const r = await POST(new Request(`${APP}/api/v1/tick?step=market`, { method: "POST", headers: { authorization: `Bearer ${KEY}` } }));
    expect((await r.json()).status).toBe("skipped");
    await drainAfter();
    expect(ran).toEqual([]);
  });

  it("skips the AI-only steps while AI is paused, but still runs the rest", async () => {
    const { setAiPaused } = await import("@/lib/admin/ai-pause");
    await setAiPaused(true, "test");
    await cron(); await drainAfter();
    expect(ran).toEqual(["core", "intent", "agent"]);
    const rows = await outcomes();
    expect(rows.find((r) => r.job === "Daily check · intel")?.note).toMatch(/^skipped \(AI paused\)/);
    expect(rows.find((r) => r.job === "Daily check · market")?.note).toMatch(/^skipped \(AI paused\)/);
    await setAiPaused(false, "test");
  });

  it("records a protected-deployment answer, stops there, and raises the alert", async () => {
    respond = () => new Response("<html>Authentication Required · Vercel</html>", { status: 401, headers: { "content-type": "text/html" } });
    await cron(); await drainAfter();
    expect(ran).toEqual(["core"]);
    const h = (await outcomes()).find((r) => r.job === "Daily check · handoff");
    expect(h).toMatchObject({ ok: false });
    expect(h?.note).toMatch(/→ intel protected 401 host=abm\.test/);
    const [a] = await chainAlerts(new Date(Date.now() + 60 * 60_000));
    expect(a).toMatchObject({ key: "chain_broken" });
    expect(a.fix).toMatch(/APP_URL|Protection Bypass/);
  });

  it("refuses a hand-off without the secret, and the caller records it as unauthorized", async () => {
    respond = (url, init) => POST(new Request(url, { ...init, headers: {} }));
    await cron(); await drainAfter();
    expect(ran).toEqual(["core"]);
    expect((await outcomes()).find((r) => r.job === "Daily check · handoff")?.note).toMatch(/→ intel unauthorized 401/);
  });

  it("a failing step is recorded as failed and the chain still goes on", async () => {
    respond = async (url, init) => {
      if (url.includes("step=intent")) { const r = await POST(new Request(url, init)); return r; }
      return POST(new Request(url, init));
    };
    const { tickStep } = await import("@/lib/pipeline/orchestrator");
    const spy = vi.spyOn(await import("@/lib/pipeline/orchestrator"), "tickStep");
    spy.mockImplementation(async (step) => { ran.push(step); if (step === "intent") throw new Error("intent broke"); return { step } as never; });
    void tickStep;
    await cron(); await drainAfter();
    spy.mockRestore();
    expect(ran).toEqual(["core", "intel", "intent", "market", "agent"]);
    expect((await outcomes()).find((r) => r.job === "Daily check · intent")).toMatchObject({ ok: false });
  });

  it("a network failure is retried once; a second failure is recorded", async () => {
    let calls = 0;
    respond = () => { calls++; throw new TypeError("fetch failed"); };
    await cron(); await drainAfter(); // one real 5 s pause before the single retry
    expect(calls).toBe(2);
    expect((await outcomes()).find((r) => r.job === "Daily check · handoff")?.note).toMatch(/→ intel network host=abm\.test attempts=2/);
  }, 20_000);
  it("when the platform refuses the queue hand-off (508, the production failure), the last step does a slice itself and the alert says why", async () => {
    queueAnswer = { ok: false, outcome: "loop", status: 508, detail: "The hosting platform refused another call of the app to itself (loop protection)" };
    await cron(); await drainAfter();
    expect(ran).toEqual(["core", "intel", "intent", "market", "agent"]);
    const note = (await outcomes()).find((r) => r.job === "Daily check · handoff")?.note ?? "";
    expect(note).toMatch(/^→ queue loop 508 host=abm\.test attempts=1 run=run_[a-z0-9]+: .*loop protection\); ran one slice here instead: \d+ done, \d+ waiting/);
    const [alert] = await chainAlerts(new Date(Date.now() + 60 * 60_000));
    expect(alert.title).toMatch(/research queue/i);
    expect(alert.fix).toMatch(/loop|in a row/i);
  });
});
