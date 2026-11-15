import Papa from "papaparse";
import { ingestRows } from "@/lib/pipeline/ingest";
import { json } from "@/lib/api";
import { authorizeClient } from "@/lib/api-clients";

// POST text/csv. Same rules as the UI import. The companies go to the client the key belongs to
// (or the client named in x-client-id when the workspace key is used).
export async function POST(req: Request) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const auth = await authorizeClient(req);
  if ("response" in auth) return auth.response;
  const text = await req.text();
  if (text.length > 5 * 1024 * 1024) return json({ error: "too_large" }, 413);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (!parsed.data.length) return json({ error: "no_rows" }, 400);
  if (parsed.data.length > 5000) return json({ error: "too_many_rows" }, 413);
  return json(await ingestRows(parsed.data, { sellerId: auth.clientId, source: "api", filename: req.headers.get("x-filename") ?? undefined, createdBy: "API" }), 201);
}
