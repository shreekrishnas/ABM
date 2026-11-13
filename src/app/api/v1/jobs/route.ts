import { after } from "next/server";
import { authorize, json } from "@/lib/api";
import { runJob } from "@/lib/jobs";

// Runs one background job in its own request: answers 202 at once, works after the reply.
// Same key as the queue; called only by the app itself (lib/jobs kickJob).
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = authorize(req, { alsoAccept: [process.env.CRON_SECRET?.trim() || undefined] });
  if (denied) return denied;
  const id = ((await req.json().catch(() => ({}))) as { id?: string }).id;
  if (!id || typeof id !== "string") return json({ error: "id required" }, 400);
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  after(() => runJob(id));
  return json({ status: "started", id }, 202);
}
