"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { logAction, refresh, startBackgroundQueue } from "@/lib/action-utils";
import { newContext } from "@/lib/pipeline/context";
import type { ActionState } from "@/app/actions";

/** Step 1: the AI drafts criteria from the description; the person reviews them before any search. */
export async function draftDiscoveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const brief = String(fd.get("brief") ?? "").trim();
  if (brief.length < 15) return { ok: false, message: "Describe the companies in a sentence or two (industry, country, size, what they must be doing)" };
  if (brief.length > 1000) return { ok: false, message: "Keep the description under 1,000 characters" };
  await logAction("discovery.start", { detail: brief.slice(0, 120) });
  const { getMe } = await import("@/lib/me");
  const me = await getMe();
  const { draftDiscovery } = await import("@/lib/discover/describe");
  const { MonthlyBudgetExceeded } = await import("@/lib/budget");
  let id: string;
  try {
    id = (await draftDiscovery(brief, me?.email ?? null, newContext())).id;
  } catch (e) {
    if (e instanceof MonthlyBudgetExceeded) return { ok: false, message: e.message };
    throw e;
  }
  redirect(`/import/describe?search=${id}`);
}

const lines = (fd: FormData, k: string) => String(fd.get(k) ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** Step 2: save the (edited) criteria and search; candidates are researched in the background. */
export async function runDiscoveryAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  // Scoped read: only searches of a client this person can see.
  const search = await db.discoverySearch.findUnique({ where: { id } });
  if (!search) return { ok: false, message: "Search not found" };
  if (search.status === "searching") return { ok: false, message: "This search is already running" };
  const { cleanCriteria, runDiscovery } = await import("@/lib/discover/describe");
  const stages = lines(fd, "fundingStages");
  const criteria = cleanCriteria({
    summary: String(fd.get("summary") ?? ""), industries: lines(fd, "industries"), countries: lines(fd, "countries"),
    minEmployees: fd.get("minEmployees"), maxEmployees: fd.get("maxEmployees"), businessModels: lines(fd, "businessModels"),
    mustHave: lines(fd, "mustHave"), niceToHave: lines(fd, "niceToHave"), exclude: lines(fd, "exclude"), technologies: lines(fd, "technologies"),
    signals: lines(fd, "signals"), queries: String(fd.get("queries") ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
    funding: stages.length || fd.get("fundingMinUsd") || fd.get("fundingWithinMonths") ? { stages, minAmountUsd: fd.get("fundingMinUsd"), withinMonths: fd.get("fundingWithinMonths") } : null,
  }, search.brief);
  if (!criteria.industries.length && !criteria.mustHave.length && !criteria.technologies.length && !criteria.signals.length) return { ok: false, message: "Add at least an industry, a must-have, a technology or a signal so the search has something to look for" };
  await db.discoverySearch.update({ where: { id }, data: { criteria: criteria as never } });
  await logAction("discovery.run", { detail: criteria.summary.slice(0, 120) });
  const { MonthlyBudgetExceeded } = await import("@/lib/budget");
  let r;
  try {
    r = await runDiscovery(id, newContext());
  } catch (e) {
    if (e instanceof MonthlyBudgetExceeded) return { ok: false, message: e.message };
    throw e;
  }
  if (r.queued) await startBackgroundQueue();
  refresh("/import/describe");
  if (!r.found) return { ok: false, message: "No companies found for these criteria; broaden the industries or add search queries" };
  return { ok: true, message: `${r.found} found, ${r.queued} being researched now${r.excluded ? `, ${r.excluded} outside your targeting rule` : ""}${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}. Results appear below as each one finishes.` };
}
