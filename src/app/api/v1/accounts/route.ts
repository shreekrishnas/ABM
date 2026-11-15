import { z } from "zod";
import { baseDb } from "@/lib/db-base";
import { ingestRows, IngestRow } from "@/lib/pipeline/ingest";
import { json, parseBody, serialize } from "@/lib/api";
import { authorizeClient } from "@/lib/api-clients";

// Companies of one client: the client the key belongs to, or the one named in x-client-id
// (or clientId in the body) with the workspace key.

export async function GET(req: Request) {
  const auth = await authorizeClient(req);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const take = Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50);
  const stage = url.searchParams.get("stage") ?? undefined;
  const accounts = await baseDb.account.findMany({
    where: { sellerId: auth.clientId, mergedIntoId: null, ...(stage ? { stage: stage as never } : {}) },
    orderBy: { updatedAt: "desc" },
    take,
  });
  return json(serialize({ data: accounts }));
}

const Body = z.object({ clientId: z.string().min(1).optional(), rows: z.array(IngestRow).min(1).max(1000), run: z.boolean().optional() });

export async function POST(req: Request) {
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const auth = await authorizeClient(req, b.data.clientId);
  if ("response" in auth) return auth.response;
  const res = await ingestRows(b.data.rows, { sellerId: auth.clientId, source: "api", createdBy: "API" });
  if (b.data.run) {
    const { runBatch } = await import("@/lib/pipeline/orchestrator");
    return json({ ...res, runs: await runBatch(res.accountIds) }, 201);
  }
  return json(res, 201);
}
