import { newContext } from "@/lib/pipeline/context";
import { processIntent, tick } from "@/lib/pipeline/orchestrator";
import { authorize, json } from "@/lib/api";

// Call from a cron every few minutes: advances sequences, sends approved drafts,
// processes due watchlist entries and intent surges, escalates late handoffs.
export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const ctx = newContext();
  const result = await tick(ctx);
  const intent = await processIntent(ctx);
  return json({ ...result, intentReruns: intent.length });
}
