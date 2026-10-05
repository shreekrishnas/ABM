import { z } from "zod";
import { runAccount } from "@/lib/pipeline/orchestrator";
import { authorize, json, parseBody } from "@/lib/api";

const Body = z.object({ accountIds: z.array(z.string()).min(1).max(100), fromStage: z.number().int().min(2).max(11).optional() });

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const results = [];
  for (const id of b.data.accountIds) results.push(await runAccount(id, { fromStage: b.data.fromStage }));
  return json({ results });
}
