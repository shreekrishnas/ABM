"use server";

// Server actions for finding new companies: the market scan, lookalikes, website visitors,
// and the approval step that turns a suggestion into a company.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { newContext } from "@/lib/pipeline/context";
import { decider, refresh, startBackgroundQueue, str, logAction } from "@/lib/action-utils";
import type { ActionState } from "@/app/actions";


/** The client in view (jobs are tied to it) and who started the job. */
async function jobOwner() {
  const { activeSellerId } = await import("@/lib/scope");
  return { sellerId: await activeSellerId(), createdBy: await decider() };
}

async function liveOrSample(sellerId: string): Promise<string | null> {
  if (sellerId === "test") return null;
  const { researchAllowed } = await import("@/lib/admin/research-clients");
  return (await researchAllowed(sellerId)) ? null : "Live research is off for this client. A Super Admin can switch it on in the client's settings.";
}

/** Scan the market in the background; the top bar says when it's done. */
export async function scanMarketAction(): Promise<ActionState> {
  await logAction("discover.scan");
  const o = await jobOwner();
  const off = await liveOrSample(o.sellerId);
  if (off) return { ok: false, message: off };
  const { startJob } = await import("@/lib/jobs");
  return startJob("scan_market", { ...o, label: "Scan the market" });
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
  const o = await jobOwner();
  const off = await liveOrSample(o.sellerId);
  if (off) return { ok: false, message: off };
  const { startJob } = await import("@/lib/jobs");
  return startJob("lookalikes", { ...o, label: `Find companies like ${site}`, params: { website: site } });
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
  if (!s || (s.origin !== "lookalike" && s.origin !== "discovery")) return { ok: false, message: "Company not found" };
  if (s.status === "added") return { ok: false, message: "Already approved: research continues on its company page" };
  const { requestMoreResearch } = await import("@/lib/discover/lookalike");
  await requestMoreResearch(id, str(fd, "note") ?? null);
  await startBackgroundQueue();
  refresh("/import/lookalikes");
  return { ok: true, message: `Researching ${s.name} further; the results update here in a few minutes` };
}

/** Pull website visitors from Apollo now (normally daily); new companies wait in Discover for approval. */
export async function fetchApolloVisitorsAction(): Promise<ActionState> {
  await logAction("visitors.fetch");
  const o = await jobOwner();
  const { startJob } = await import("@/lib/jobs");
  return startJob("apollo_fetch", { ...o, label: "Fetch website visitors from Apollo" });
}

export async function dismissSuggestionAction(id: string): Promise<ActionState> {
  await logAction("suggestion.dismiss", { suggestionId: id });
  const { dismissSuggestion } = await import("@/lib/discover/scan");
  await dismissSuggestion(id, await decider());
  refresh("/discover");
  return { ok: true, message: "Dismissed" };
}
