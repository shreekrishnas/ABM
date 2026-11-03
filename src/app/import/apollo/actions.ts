"use server";

// Website visitors: Apollo enrichment and the selective pipeline import. The Excel download
// is a plain GET (./export) and never depends on these.

import { decider, logAction, refresh, startBackgroundQueue } from "@/lib/action-utils";
import type { ActionState } from "@/app/actions";
import { enrichCompanies, importCompanies, listVisitorCompanies, parseRange, previewImport, type ImportPreviewItem } from "@/lib/web/visitor-prospects";

type Range = { from?: string; to?: string };

export async function enrichVisitorsAction(keys: string[], range: Range, force = false): Promise<ActionState> {
  if (!keys.length) return { ok: false, message: "Select at least one company" };
  await logAction("visitors.enrich", { detail: `${keys.length} companies` });
  const { from, to } = parseRange(range.from, range.to);
  const want = new Set(keys);
  const companies = (await listVisitorCompanies(from, to)).filter((c) => want.has(c.key));
  const r = await enrichCompanies(companies, await decider(), { force });
  refresh("/import/apollo");
  if (r.not_connected) return { ok: false, message: "Apollo isn't connected — add APOLLO_API_KEY in Vercel" };
  const parts = [
    r.found && `${r.found} with prospects`,
    r.no_prospects && `${r.no_prospects} with nobody in the target roles`,
    r.no_match && `${r.no_match} not found in Apollo`,
    r.failed && `${r.failed} failed (earlier results kept; try again later)`,
    r.cached && `${r.cached} already enriched this week`,
  ].filter(Boolean);
  return { ok: r.failed < companies.length, message: `Apollo: ${parts.join(" · ") || "nothing to do"}` };
}

export async function previewVisitorImportAction(keys: string[], range: Range): Promise<ImportPreviewItem[]> {
  const { from, to } = parseRange(range.from, range.to);
  return previewImport(keys, from, to);
}

export async function importVisitorsAction(keys: string[], range: Range, excludeCustomers: boolean): Promise<ActionState> {
  if (!keys.length) return { ok: false, message: "No companies selected to import" };
  await logAction("visitors.import", { detail: `${keys.length} companies${excludeCustomers ? ", customers excluded" : ""}` });
  const { from, to } = parseRange(range.from, range.to);
  let r;
  try {
    r = await importCompanies(keys, from, to, { excludeCustomers, by: await decider() });
  } catch (e) {
    return { ok: false, message: `Import failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"} — nothing was lost; try again` };
  }
  if (r.batchId) await startBackgroundQueue();
  refresh("/import/apollo", "/accounts", "/import");
  if (!r.imported) return { ok: false, message: r.skipped ? `Nothing imported: all ${r.skipped} selected companies are existing customers` : "Nothing imported" };
  return {
    ok: true,
    message: `Added ${r.imported} compan${r.imported === 1 ? "y" : "ies"} and ${r.prospects} prospect${r.prospects === 1 ? "" : "s"} to the pipeline${r.skipped ? ` · ${r.skipped} customer${r.skipped === 1 ? "" : "s"} excluded` : ""}${r.rejected ? ` · ${r.rejected} row${r.rejected === 1 ? "" : "s"} rejected: ${r.errors.join("; ")}` : ""}`,
  };
}
