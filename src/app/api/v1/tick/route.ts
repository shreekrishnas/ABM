import { after } from "next/server";
import { newContext } from "@/lib/pipeline/context";
import { kickDrain } from "@/lib/queue/drain";
import { processIntent, tick } from "@/lib/pipeline/orchestrator";
import { authorize, json } from "@/lib/api";

// The backend brain's heartbeat. Vercel Cron calls GET with `Authorization: Bearer
// <CRON_SECRET>`; other schedulers call POST with ABM_API_KEY. Either secret works on
// either method. In production, with neither secret set, the route refuses to run:
// every tick spends search and LLM credits.
async function run(req: Request) {
  const ctx = newContext();
  const result = await tick(ctx);
  const intent = await processIntent(ctx);
  // Whatever the tick couldn't finish in its slice continues in the background queue.
  const origin = new URL(req.url).origin;
  after(() => kickDrain(origin));
  return json({ ...result, intentReruns: intent.length });
}

export const maxDuration = 60;

function allowed(req: Request) {
  return authorize(req, { alsoAccept: [process.env.CRON_SECRET?.trim() || undefined] });
}

export async function GET(req: Request) {
  return allowed(req) ?? run(req);
}

export async function POST(req: Request) {
  return allowed(req) ?? run(req);
}
