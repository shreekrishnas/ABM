import { after } from "next/server";
import { newContext } from "@/lib/pipeline/context";
import { kickDrain } from "@/lib/queue/drain";
import { TICK_STEPS, tickStep, type TickStep } from "@/lib/pipeline/orchestrator";
import { beginStep, continueChain, executeStep, type ChainDeps } from "@/lib/pipeline/daily-chain";
import { handOff, runIdFrom } from "@/lib/pipeline/handoff";
import { authorize, json } from "@/lib/api";

// The backend brain's heartbeat. Vercel Cron calls GET with `Authorization: Bearer
// <CRON_SECRET>`; other schedulers call POST with ABM_API_KEY. Either secret works on
// either method. In production, with neither secret set, the route refuses to run:
// every tick spends search and LLM credits.
//
// The daily check runs as a chain of steps (core → intel → intent → market → agent), one per
// request (src/lib/pipeline/daily-chain.ts):
// - core runs inside the scheduler's request, as before, then hands off to intel;
// - later steps take their per-day lease, record "started", answer 202 and run in after()
//   (still inside this function's 300s limit). A "started" row with no outcome row means the
//   platform stopped the work; the per-day lease then expires so a re-run can pick it up.
// - every hand-off reads the answer and records failures; one run id ties a day together.

async function deps(): Promise<ChainDeps> {
  const [{ recordRun }, { recordError }, { aiPause }, lease] = await Promise.all([
    import("@/lib/admin/ops"),
    import("@/lib/admin/errors"),
    import("@/lib/admin/ai-pause"),
    import("@/lib/pipeline/step-lease"),
  ]);
  return {
    runTick: (step) => tickStep(step, newContext()),
    claim: lease.claimStep,
    finish: lease.finishStep,
    record: recordRun,
    recordError,
    aiPaused: async () => Boolean(await aiPause()),
    handOff,
    kickDrain: (origin, runId) => kickDrain(origin, runId),
  };
}

async function run(req: Request) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const url = new URL(req.url);
  const asked = url.searchParams.get("step");
  const step: TickStep = (TICK_STEPS as readonly string[]).includes(asked ?? "") ? (asked as TickStep) : "core";
  const runId = runIdFrom(req);
  const d = await deps();

  const begun = await beginStep(step, runId, d);
  if (begun.status === "skipped") return json({ step, runId, status: "skipped", reason: begun.reason });

  if (step === "core") {
    (await import("@/lib/pipeline/step-lease")).pruneStepLeases().catch(() => undefined);
    const r = await executeStep(step, runId, begun.claimedAt, d);
    after(() => continueChain(step, runId, url.origin, d).then(() => undefined));
    return json({ step, runId, status: r.ok ? "completed" : "failed", next: "intel", ...(r.result && typeof r.result === "object" ? r.result : {}) }, r.ok ? 200 : 500);
  }

  // Later steps: accepted now, worked on after the reply (within maxDuration).
  after(async () => {
    await executeStep(step, runId, begun.claimedAt, d);
    await continueChain(step, runId, url.origin, d);
  });
  return json({ step, runId, status: "started" }, 202);
}

// One step can still take a few minutes of live research on a busy day.
export const maxDuration = 300;

function allowed(req: Request) {
  return authorize(req, { alsoAccept: [process.env.CRON_SECRET?.trim() || undefined] });
}

export async function GET(req: Request) {
  return allowed(req) ?? run(req);
}

export async function POST(req: Request) {
  return allowed(req) ?? run(req);
}
