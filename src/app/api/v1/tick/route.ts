import { after } from "next/server";
import { newContext } from "@/lib/pipeline/context";
import { kickDrain, selfToken } from "@/lib/queue/drain";
import { TICK_STEPS, tickStep, type TickStep } from "@/lib/pipeline/orchestrator";
import { authorize, json } from "@/lib/api";

// The backend brain's heartbeat. Vercel Cron calls GET with `Authorization: Bearer
// <CRON_SECRET>`; other schedulers call POST with ABM_API_KEY. Either secret works on
// either method. In production, with neither secret set, the route refuses to run:
// every tick spends search and LLM credits.
//
// The daily check runs as a chain of steps (?step=core → intel → intent → market), one per
// request, so no single request comes near the time limit. Each step records its own run and
// starts the next; after the last, the background queue continues whatever is left.
async function run(req: Request) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const url = new URL(req.url);
  const asked = url.searchParams.get("step");
  const step: TickStep = (TICK_STEPS as readonly string[]).includes(asked ?? "") ? (asked as TickStep) : "core";
  const startedAt = new Date();
  const { recordRun } = await import("@/lib/admin/ops");
  const label = step === "core" ? "Daily check" : `Daily check · ${step}`;
  let result: Awaited<ReturnType<typeof tickStep>>;
  try {
    result = await tickStep(step, newContext());
  } catch (e) {
    await recordRun(label, startedAt, { ok: false, note: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  await recordRun(label, startedAt, { ok: true, note: JSON.stringify(result).slice(0, 180) });
  const next = TICK_STEPS[TICK_STEPS.indexOf(step) + 1];
  after(async () => { if (next) await kickStep(url.origin, next); else await kickDrain(url.origin); });
  return json({ step, next: next ?? null, ...result });
}

async function kickStep(origin: string, step: TickStep) {
  const base = (process.env.APP_URL?.trim() || origin).replace(/\/$/, "");
  const token = selfToken();
  await fetch(`${base}/api/v1/tick?step=${step}`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => undefined);
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
