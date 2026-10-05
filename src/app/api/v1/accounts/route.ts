import { z } from "zod";
import { db } from "@/lib/db";
import { ingestRows, IngestRow } from "@/lib/pipeline/ingest";
import { authorize, json, parseBody, serialize } from "@/lib/api";

export async function GET(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const take = Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50);
  const stage = url.searchParams.get("stage") ?? undefined;
  const accounts = await db.account.findMany({
    where: { mergedIntoId: null, ...(stage ? { stage: stage as never } : {}) },
    orderBy: { updatedAt: "desc" },
    take,
  });
  return json(serialize({ data: accounts }));
}

const Body = z.object({ rows: z.array(IngestRow).min(1).max(1000), run: z.boolean().optional() });

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const res = await ingestRows(b.data.rows, { source: "api" });
  if (b.data.run) {
    const { runBatch } = await import("@/lib/pipeline/orchestrator");
    return json({ ...res, runs: await runBatch(res.accountIds) }, 201);
  }
  return json(res, 201);
}
