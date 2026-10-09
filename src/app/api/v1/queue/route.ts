import { after } from "next/server";
import { authorize, json } from "@/lib/api";
import { drainOnce, kickDrain, queueStatus, shouldContinue } from "@/lib/queue/drain";

// Background queue. POST starts (or continues) the drain chain: it answers 202 right
// away, works through queued companies for one slice after responding, and calls itself
// again while work is left. GET reports the queue. Same auth as the scheduler.
export const maxDuration = 60;

const allowed = (req: Request) => authorize(req, { alsoAccept: [process.env.CRON_SECRET?.trim() || undefined] });

export async function GET(req: Request) {
  return allowed(req) ?? json(await queueStatus());
}

export async function POST(req: Request) {
  const denied = allowed(req);
  if (denied) return denied;
  const status = await queueStatus();
  if (status.queued === 0) return json({ status: "idle", queued: 0 });
  if (status.working) return json({ status: "busy", queued: status.queued });
  const origin = new URL(req.url).origin;
  after(async () => {
    const r = await drainOnce();
    if (shouldContinue(r)) await kickDrain(origin);
  });
  return json({ status: "started", queued: status.queued }, 202);
}
