import { authorize, json } from "@/lib/api";
import { runLoop } from "@/lib/agent/loop";

// JARVIS Level 1 pass for every client that switched it on. The daily check runs it as its
// last step; an outside scheduler may call it more often (same keys as /api/v1/tick).
export const maxDuration = 300;

async function run() {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const startedAt = new Date();
  const reports = await runLoop();
  const { recordRun } = await import("@/lib/admin/ops");
  await recordRun("JARVIS loop", startedAt, { ok: true, note: `${reports.reduce((n, r) => n + r.ran.length, 0)} actions across ${reports.length} client(s)` });
  return json({ reports });
}

const allowed = (req: Request) => authorize(req, { alsoAccept: [process.env.CRON_SECRET?.trim() || undefined] });
export async function GET(req: Request) { return allowed(req) ?? run(); }
export async function POST(req: Request) { return allowed(req) ?? run(); }
