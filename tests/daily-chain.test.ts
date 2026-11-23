import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyResponse, handOff, retryable, runIdFrom, selfBaseUrl, selfHeaders, stepLeaseName } from "@/lib/pipeline/handoff";
import { beginStep, continueChain, executeStep, stepLabel, type ChainDeps } from "@/lib/pipeline/daily-chain";
import { claimStep, finishStep } from "@/lib/pipeline/step-lease";
import { baseDb } from "@/lib/db-base";

const ENV = ["APP_URL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_AUTOMATION_BYPASS_SECRET", "ABM_API_KEY", "CRON_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const res = (status: number, body = "", type = "application/json", headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": type, ...headers } });

describe("where the chain calls itself", () => {
  it("prefers APP_URL, then Vercel's production address (production only), then the request origin", () => {
    expect(selfBaseUrl("https://abm-abc123-team.vercel.app")).toBe("https://abm-abc123-team.vercel.app");
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "app.example.com";
    expect(selfBaseUrl("https://abm-abc123-team.vercel.app")).toBe("https://abm-abc123-team.vercel.app"); // not production
    process.env.VERCEL_ENV = "production";
    expect(selfBaseUrl("https://abm-abc123-team.vercel.app")).toBe("https://app.example.com");
    process.env.APP_URL = "https://public.example.com/";
    expect(selfBaseUrl("https://abm-abc123-team.vercel.app")).toBe("https://public.example.com");
  });
  it("sends the bearer secret, the run id, and the Vercel bypass only when configured", () => {
    process.env.CRON_SECRET = "c-secret";
    expect(selfHeaders("run_abc123")).toEqual({ authorization: "Bearer c-secret", "x-abm-run-id": "run_abc123" });
    process.env.ABM_API_KEY = "k-secret";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass";
    expect(selfHeaders()).toEqual({ authorization: "Bearer k-secret", "x-vercel-protection-bypass": "bypass" });
  });
  it("accepts only a well-formed run id from a request", () => {
    expect(runIdFrom(new Request("https://x/api?run=run_abcdef12"))).toBe("run_abcdef12");
    expect(runIdFrom(new Request("https://x/api?run=<script>"))).toMatch(/^run_[a-z0-9]{12}$/);
  });
});

describe("reading the next step's answer", () => {
  it("recognises the platform's loop limit (508), which a retry can't fix", async () => {
    expect(await classifyResponse(res(508, "INFINITE_LOOP_DETECTED", "text/plain"))).toMatchObject({ outcome: "loop" });
    expect(await classifyResponse(res(500, "The page could not be loaded: INFINITE_LOOP_DETECTED", "text/plain"))).toMatchObject({ outcome: "loop" });
    expect(retryable({ outcome: "loop", status: 508 })).toBe(false);
  });
  it("tells Vercel's protection page apart from the app refusing the secret", async () => {
    expect((await classifyResponse(res(401, "<html>Authentication Required</html>", "text/html"))).outcome).toBe("protected");
    expect((await classifyResponse(res(401, JSON.stringify({ error: "unauthorized" })))).outcome).toBe("unauthorized");
    expect((await classifyResponse(res(503, JSON.stringify({ error: "api_key_not_configured" })))).outcome).toBe("not_configured");
    expect((await classifyResponse(res(202, "{}"))).outcome).toBe("accepted");
  });
  it("retries only when the step clearly never started", () => {
    expect(retryable({ outcome: "network", status: null })).toBe(true);
    expect(retryable({ outcome: "server_error", status: 503 })).toBe(true);
    expect(retryable({ outcome: "server_error", status: 500 })).toBe(false);
    expect(retryable({ outcome: "timeout", status: null })).toBe(false);
    expect(retryable({ outcome: "protected", status: 401 })).toBe(false);
    expect(retryable({ outcome: "unauthorized", status: 401 })).toBe(false);
  });
});

describe("handOff", () => {
  const url = "https://app.example.com/api/v1/tick?step=intel";
  it("reports a protected deployment without retrying", async () => {
    const f = vi.fn(async () => res(401, "<html>Vercel Authentication</html>", "text/html"));
    const r = await handOff({ url, runId: "run_abcdef", fetchImpl: f as unknown as typeof fetch, retryDelayMs: 0 });
    expect(r).toMatchObject({ ok: false, outcome: "protected", status: 401, host: "app.example.com", attempts: 1 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("reports an auth refusal without retrying", async () => {
    const f = vi.fn(async () => res(401, JSON.stringify({ error: "unauthorized" })));
    expect(await handOff({ url, runId: "run_abcdef", fetchImpl: f as unknown as typeof fetch, retryDelayMs: 0 })).toMatchObject({ outcome: "unauthorized", attempts: 1 });
  });
  it("retries a network failure once, then succeeds", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(res(202, "{}"));
    expect(await handOff({ url, runId: "run_abcdef", fetchImpl: f as unknown as typeof fetch, retryDelayMs: 0 })).toMatchObject({ ok: true, outcome: "accepted", attempts: 2 });
  });
  it("gives up after a second network failure", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await handOff({ url, runId: "run_abcdef", fetchImpl: f as unknown as typeof fetch, retryDelayMs: 0 })).toMatchObject({ ok: false, outcome: "network", attempts: 2 });
  });
  it("records a timeout and does not retry it (the step may already be running)", async () => {
    const f = vi.fn(async () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; });
    expect(await handOff({ url, runId: "run_abcdef", fetchImpl: f as unknown as typeof fetch, retryDelayMs: 0 })).toMatchObject({ ok: false, outcome: "timeout", attempts: 1 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("sends the run id and secret on the request", async () => {
    process.env.ABM_API_KEY = "k-secret";
    const f = vi.fn(async (_u: string, _i: RequestInit) => res(202, "{}"));
    await handOff({ url, runId: "run_abcdef", fetchImpl: f as unknown as typeof fetch });
    const init = f.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer k-secret", "x-abm-run-id": "run_abcdef" });
  });
});

function fakeDeps(over: Partial<ChainDeps> = {}) {
  const rows: { job: string; ok?: boolean; note?: string | null }[] = [];
  const errors: string[] = [];
  const leases = new Map<string, "running" | "done">();
  const d: ChainDeps = {
    runTick: async (step) => ({ step }),
    claim: async (step) => { const s = leases.get(step); if (s) return { ok: false, reason: s, holder: "run_other" }; leases.set(step, "running"); return { ok: true }; },
    finish: async (step, _r, o) => { if (o.ok) leases.set(step, "done"); else leases.delete(step); },
    record: async (job, _t, r) => { rows.push({ job, ok: r.ok, note: r.note }); },
    recordError: async (s) => { errors.push(s); },
    aiPaused: async () => false,
    handOff: async () => ({ ok: true, outcome: "accepted", status: 202, host: "app.example.com", attempts: 1, ms: 5 }),
    startQueue: async () => ({ ok: true, outcome: "accepted", status: 202, host: "app.example.com", attempts: 1, ms: 4 }),
    drainHere: async () => ({ processed: 0, remaining: 0 }),
    ...over,
  };
  return { d, rows, errors, leases };
}

describe("stage transitions", () => {
  it("records started then completed, with the run id on both", async () => {
    const { d, rows } = fakeDeps();
    const b = await beginStep("intel", "run_abcdef", d);
    expect(b.status).toBe("claimed");
    if (b.status === "claimed") await executeStep("intel", "run_abcdef", b.claimedAt, d);
    expect(rows.map((r) => r.job)).toEqual(["Daily check · intel · started", "Daily check · intel"]);
    expect(rows[1].note).toMatch(/^completed run=run_abcdef/);
  });
  it("records a failure, logs the error, and frees the lease for a later re-run", async () => {
    const { d, rows, errors, leases } = fakeDeps({ runTick: async () => { throw new Error("boom"); } });
    const b = await beginStep("intent", "run_abcdef", d);
    if (b.status === "claimed") expect((await executeStep("intent", "run_abcdef", b.claimedAt, d)).ok).toBe(false);
    expect(rows.at(-1)).toMatchObject({ job: "Daily check · intent", ok: false });
    expect(errors).toContain("daily check · intent");
    expect(leases.has("intent")).toBe(false);
  });
  it("skips AI-only steps while AI is paused, and says so (without running them)", async () => {
    const runTick = vi.fn(async () => ({}));
    const { d, rows } = fakeDeps({ aiPaused: async () => true, runTick });
    const b = await beginStep("market", "run_abcdef", d);
    if (b.status === "claimed") await executeStep("market", "run_abcdef", b.claimedAt, d);
    expect(runTick).not.toHaveBeenCalled();
    expect(rows.at(-1)?.note).toMatch(/^skipped \(AI paused\)/);
  });
  it("never runs a step twice in a day: a repeat is recorded as skipped", async () => {
    const runTick = vi.fn(async () => ({}));
    const { d, rows } = fakeDeps({ runTick });
    for (let i = 0; i < 2; i++) {
      const b = await beginStep("agent", `run_${i}abcdef`, d);
      if (b.status === "claimed") await executeStep("agent", `run_${i}abcdef`, b.claimedAt, d);
    }
    expect(runTick).toHaveBeenCalledTimes(1);
    expect(rows.at(-1)?.note).toMatch(/^skipped \(already completed today\)/);
  });
  it("hands off to the next step with the run id, and records a failed hand-off", async () => {
    const calls: string[] = [];
    const { d, rows, errors } = fakeDeps({ handOff: async (o) => { calls.push(o.url); return { ok: false, outcome: "protected", status: 401, host: "app.example.com", attempts: 1, ms: 3, detail: "Vercel deployment protection answered instead of the app" }; } });
    process.env.APP_URL = "https://app.example.com";
    await continueChain("core", "run_abcdef", "https://abm-abc-team.vercel.app", d);
    expect(calls).toEqual(["https://app.example.com/api/v1/tick?step=intel&run=run_abcdef"]);
    expect(rows.at(-1)).toMatchObject({ job: "Daily check · handoff", ok: false });
    expect(rows.at(-1)?.note).toMatch(/→ intel protected 401 host=app\.example\.com/);
    expect(errors).toContain("daily check · handoff");
  });
  it("starts the research queue after the last step, on its own request", async () => {
    const startQueue = vi.fn(async () => ({ ok: true, outcome: "accepted" as const, status: 202, host: "app.example.com", attempts: 1, ms: 4 }));
    const drainHere = vi.fn(async () => ({ processed: 1, remaining: 0 }));
    const { d, rows } = fakeDeps({ startQueue, drainHere });
    expect(await continueChain("agent", "run_abcdef", "https://app.example.com", d)).toMatchObject({ ok: true, outcome: "accepted" });
    expect(startQueue).toHaveBeenCalledWith("https://app.example.com", "run_abcdef");
    expect(drainHere).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
  it("when the queue can't be started on its own (platform loop limit), runs one slice here and records exactly why", async () => {
    const drainHere = vi.fn(async () => ({ processed: 3, remaining: 408 }));
    const { d, rows, errors } = fakeDeps({
      startQueue: async () => ({ ok: false, outcome: "loop", status: 508, host: "app.example.com", attempts: 1, ms: 40, detail: "The hosting platform refused another call of the app to itself (loop protection)" }),
      drainHere,
    });
    const r = await continueChain("agent", "run_abcdef", "https://app.example.com", d);
    expect(r).toMatchObject({ ok: false, outcome: "loop", status: 508 });
    expect(drainHere).toHaveBeenCalledWith("run_abcdef");
    expect(rows.at(-1)).toMatchObject({ job: "Daily check · handoff", ok: false });
    expect(rows.at(-1)?.note).toMatch(/^→ queue loop 508 host=app\.example\.com attempts=1 run=run_abcdef: .*loop protection.*; ran one slice here instead: 3 done, 408 waiting$/);
    expect(errors).toContain("daily check · handoff");
  });
  it("says why a slice here did nothing (AI paused), and survives the slice failing too", async () => {
    const paused = fakeDeps({ startQueue: async () => ({ ok: false, outcome: "server_error", status: 500, host: "app.example.com", attempts: 1, ms: 9, detail: "queue_failed" }), drainHere: async () => ({ processed: 0, remaining: 411, reason: "AI is paused" }) });
    await continueChain("agent", "run_abcdef", "https://app.example.com", paused.d);
    expect(paused.rows.at(-1)?.note).toMatch(/ran one slice here instead: 0 done, 411 waiting \(AI is paused\)$/);
    const broken = fakeDeps({ startQueue: async () => ({ ok: false, outcome: "timeout", status: null, host: "app.example.com", attempts: 1, ms: 10_000 }), drainHere: async () => { throw new Error("database unavailable"); } });
    await continueChain("agent", "run_abcdef", "https://app.example.com", broken.d);
    expect(broken.rows.at(-1)?.note).toMatch(/→ queue timeout host=app\.example\.com .*; the slice here failed too: database unavailable$/);
    const thrown = fakeDeps({ startQueue: async () => { throw new Error("fetch failed"); } });
    expect(await continueChain("agent", "run_abcdef", "https://app.example.com", thrown.d)).toMatchObject({ ok: false, outcome: "network" });
  });
  it("labels core the way the 'daily check missed' alert expects", () => {
    expect(stepLabel("core")).toBe("Daily check");
    expect(stepLabel("market")).toBe("Daily check · market");
  });
});

describe("per-day step lease (database)", () => {
  const day = new Date("2031-03-04T02:37:00Z");
  const names = ["intel", "intent", "market"].map((s) => stepLeaseName(s, day));

  it("keeps a running step's lease past any function lifetime, so a slow step can't be run twice", async () => {
    const min = 60_000;
    expect(await claimStep("market", "run_aaaaaa", day)).toEqual({ ok: true });
    expect(await claimStep("market", "run_bbbbbb", new Date(day.getTime() + 7 * min))).toMatchObject({ ok: false, reason: "running" });
    expect(await claimStep("market", "run_bbbbbb", new Date(day.getTime() + 14 * min))).toMatchObject({ ok: false, reason: "running" });
    // Only after the lease can no longer belong to a live function is it free (the run was cut off).
    expect(await claimStep("market", "run_bbbbbb", new Date(day.getTime() + 16 * min))).toEqual({ ok: true });
  });
  afterAll(async () => { await baseDb.jobLease.deleteMany({ where: { name: { in: names } } }); });

  it("lets one run take a step; a second run is skipped while it runs and after it completes", async () => {
    expect(await claimStep("intel", "run_aaaaaa", day)).toEqual({ ok: true });
    expect(await claimStep("intel", "run_bbbbbb", day)).toMatchObject({ ok: false, reason: "running", holder: "run_aaaaaa" });
    await finishStep("intel", "run_aaaaaa", { ok: true }, day, day);
    expect(await claimStep("intel", "run_bbbbbb", new Date(day.getTime() + 60_000))).toMatchObject({ ok: false, reason: "done" });
  });
  it("frees the step after a failure so a deliberate re-run can take it", async () => {
    expect(await claimStep("intent", "run_aaaaaa", day)).toEqual({ ok: true });
    await finishStep("intent", "run_aaaaaa", { ok: false, note: "boom" }, day, day);
    expect(await claimStep("intent", "run_bbbbbb", new Date(day.getTime() + 1000))).toEqual({ ok: true });
  });
});
