import { NextResponse } from "next/server";
import { newContext } from "@/lib/pipeline/context";
import { processIntent, tick } from "@/lib/pipeline/orchestrator";
import { authorize, json } from "@/lib/api";

// The backend brain's heartbeat. Vercel Cron calls GET (with CRON_SECRET); other
// schedulers call POST (with ABM_API_KEY). Works through queued imports, follow-ups,
// approved sends, watch-list re-checks, intent surges, escalations and the weekly learning pass.
async function run() {
  const ctx = newContext();
  const result = await tick(ctx);
  const intent = await processIntent(ctx);
  return json({ ...result, intentReruns: intent.length });
}

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!secret && authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return run();
}

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  return run();
}
