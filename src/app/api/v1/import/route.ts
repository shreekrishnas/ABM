import Papa from "papaparse";
import { ingestRows } from "@/lib/pipeline/ingest";
import { authorize, json } from "@/lib/api";

// POST text/csv. Same rules as the UI import.
export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const text = await req.text();
  if (text.length > 5 * 1024 * 1024) return json({ error: "too_large" }, 413);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (!parsed.data.length) return json({ error: "no_rows" }, 400);
  if (parsed.data.length > 5000) return json({ error: "too_many_rows" }, 413);
  return json(await ingestRows(parsed.data, { source: "api", filename: req.headers.get("x-filename") ?? undefined }), 201);
}
