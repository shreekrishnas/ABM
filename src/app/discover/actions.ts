"use server";

// Server actions for finding new companies: the market scan, lookalikes, website visitors,
// and the approval step that turns a suggestion into a company.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { newContext } from "@/lib/pipeline/context";
import { decider, refresh, startBackgroundQueue, str, logAction } from "@/lib/action-utils";
import type { ActionState } from "@/app/actions";

export async function scanMarketAction(): Promise<ActionState> {
  const { scanMarket } = await import("@/lib/discover/scan");
  const r = await scanMarket(newContext());
  refresh("/discover");
  return { ok: true, message: `Scanned ${r.searches} searches · ${r.events} buying events · ${r.suggestions} companies suggested · ${r.excluded} outside your targeting rule` };
}

/** Approve one suggested company: it becomes a company, research starts now, and you land on its page. */
export async function addSuggestionAction(id: string): Promise<ActionState> {
  await logAction("suggestion.approve", { suggestionId: id });
  const { addSuggestion } = await import("@/lib/discover/scan");
  const accountId = await addSuggestion(id, await decider());
  if (!accountId) return { ok: false, message: "Couldn't add this company (is it still being researched?)" };
  await startBackgroundQueue();
  refresh("/discover", "/accounts");
  redirect(`/accounts/${accountId}`);
}

/** Approve several suggested companies at once; research starts in the background. */
export async function approveSuggestionsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await logAction("suggestion.approve_many", { detail: `${fd.getAll("ids").length} companies` });
  const ids = fd.getAll("ids").filter((v): v is string => typeof v === "string");
  if (!ids.length) return { ok: false, message: "Select at least one company" };
  const { addSuggestion } = await import("@/lib/discover/scan");
  let added = 0;
  const by = await decider();
  for (const id of ids.slice(0, 100)) if (await addSuggestion(id, by)) added++;
  await startBackgroundQueue();
  refresh("/discover", "/accounts", "/import/lookalikes", "/import/apollo");
  return { ok: added > 0, message: `Approved ${added} compan${added === 1 ? "y" : "ies"} — research has started; they appear under Companies` };
}

/** Find companies similar to one website; the AI investigates each in the background, then a person decides. */
export async function findLookalikesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await logAction("lookalike.search", { detail: str(fd, "website") });
  const site = str(fd, "website");
  if (!site || site.length > 200) return { ok: false, message: "Enter a company website, e.g. example.com" };
  const { findLookalikes } = await import("@/lib/discover/lookalike");
  const { MonthlyBudgetExceeded } = await import("@/lib/budget");
  let r;
  try {
    r = await findLookalikes(site, newContext());
  } catch (e) {
    if (e instanceof MonthlyBudgetExceeded) return { ok: false, message: e.message };
    throw e;
  }
  if (r.suggested) await startBackgroundQueue();
  refresh("/discover", "/import/lookalikes");
  if (!r.found) return { ok: false, message: `No similar companies found for ${r.seed} — try its main website` };
  redirect(`/import/lookalikes?seed=${encodeURIComponent(r.seed)}`);
}

/** Reject a recommended lookalike, with an optional reason. Nothing is looked up for it. */
export async function rejectLookalikeAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await logAction("lookalike.reject", { suggestionId: id, detail: str(fd, "reason") });
  const { dismissSuggestion } = await import("@/lib/discover/scan");
  await dismissSuggestion(id, await decider(), str(fd, "reason") ? `Rejected: ${str(fd, "reason")}` : "Rejected");
  refresh("/import/lookalikes", "/discover");
  return { ok: true, message: "Rejected" };
}

/** Ask the AI to research a lookalike further (optionally: what to look into). */
export async function researchMoreAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await logAction("lookalike.research_more", { suggestionId: id, detail: str(fd, "note") });
  const s = await db.prospectSuggestion.findUnique({ where: { id } });
  if (!s || s.origin !== "lookalike") return { ok: false, message: "Company not found" };
  if (s.status === "added") return { ok: false, message: "Already approved: research continues on its company page" };
  const { requestMoreResearch } = await import("@/lib/discover/lookalike");
  await requestMoreResearch(id, str(fd, "note") ?? null);
  await startBackgroundQueue();
  refresh("/import/lookalikes");
  return { ok: true, message: `Researching ${s.name} further; the results update here in a few minutes` };
}

/** Pull website visitors from Apollo now (normally daily); new companies wait in Discover for approval. */
export async function fetchApolloVisitorsAction(): Promise<ActionState> {
  const { syncApolloVisitors } = await import("@/lib/web/apollo-sync");
  const r = await syncApolloVisitors(newContext(), { force: true });
  if (!r) return { ok: false, message: "Apollo isn't connected — set APOLLO_API_KEY and APOLLO_VISITOR_LIST in Vercel" };
  refresh("/discover", "/accounts");
  if (!r.companies) return { ok: false, message: "Apollo returned no visitor companies — check the list name, or see Behind the scenes for the error" };
  redirect("/import/apollo");
}

export async function dismissSuggestionAction(id: string): Promise<ActionState> {
  await logAction("suggestion.dismiss", { suggestionId: id });
  const { dismissSuggestion } = await import("@/lib/discover/scan");
  await dismissSuggestion(id, await decider());
  refresh("/discover");
  return { ok: true, message: "Dismissed" };
}
