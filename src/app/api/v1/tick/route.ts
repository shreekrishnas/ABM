import { newContext } from "@/lib/pipeline/context";
import { processIntent, tick } from "@/lib/pipeline/orchestrator";
import { authorize, json } from "@/lib/api";

// The backend brain's heartbeat. Vercel Cron calls GET with `Authorization: Bearer
// <CRON_SECRET>`; other schedulers call POST with ABM_API_KEY. Either secret works on
// either method. In production, with neither secret set, the route refuses to run:
// every tick spends search and LLM credits.
async function run() {
  const ctx = newContext();
  const result = await tick(ctx);
  const intent = await processIntent(ctx);
  return json({ ...result, intentReruns: intent.length });
}

export const maxDuration = 60;

function allowed(req: Request) {
  return authorize(req, { alsoAccept: [process.env.CRON_SECRET?.trim() || undefined] });
}

export async function GET(req: Request) {
  return allowed(req) ?? run();
}

export async function POST(req: Request) {
  return allowed(req) ?? run();
}
