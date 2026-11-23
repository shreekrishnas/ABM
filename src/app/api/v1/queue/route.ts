import { after } from "next/server";
import { authorize, json } from "@/lib/api";
import { runIdFrom } from "@/lib/pipeline/handoff";
import { drainOnce, kickDrain, queueStatus, requeueCutOffRuns, shouldContinue } from "@/lib/queue/drain";

// Background queue. POST starts (or continues) the drain chain: it answers 202 right away (only
// quick counts before answering, so the caller never times out waiting), then after responding
// puts back companies whose run was cut off, works through one slice, and calls itself again while
// work is left. GET reports the queue. Same auth as the scheduler.

// One company can take a few minutes of live research; a 60s limit cut runs off mid-company.
export const maxDuration = 300;

const allowed = (req: Request) => authorize(req, { alsoAccept: [process.env.CRON_SECRET?.trim() || undefined] });

export async function GET(req: Request) {
  return allowed(req) ?? json(await queueStatus());
}

export async function POST(req: Request) {
  const denied = allowed(req);
  if (denied) return denied;
  try {
    const status = await queueStatus();
    // Nothing queued and nothing running (a cut-off run counts: it is put back in the queue below).
    if (status.queued === 0 && status.running === 0) return json({ status: "idle", queued: 0 });
    if (status.working) return json({ status: "busy", queued: status.queued });
    const origin = new URL(req.url).origin;
    const runId = req.headers.get("x-abm-run-id") ? runIdFrom(req) : undefined;
    after(async () => {
      await requeueCutOffRuns();
      const r = await drainOnce({ runId });
      if (shouldContinue(r)) await kickDrain(origin, runId);
    });
    return json({ status: "started", queued: status.queued }, 202);
  } catch (e) {
    // Say why, so the caller records a reason instead of "not started".
    return json({ error: "queue_failed", message: e instanceof Error ? e.message.slice(0, 200) : String(e) }, 500);
  }
}
