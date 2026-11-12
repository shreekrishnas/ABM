"use server";

// Actions on "Recommended today": research, snooze or reject one recommendation, and run
// today's list again on demand.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { decider, logAction, refresh, startBackgroundQueue, str } from "@/lib/action-utils";
import { newContext, logEvent } from "@/lib/pipeline/context";
import { REJECT_REASONS, markDecided } from "@/lib/discover/recommend";
import type { ActionState } from "@/app/actions";

async function clientOf(kind: string, id: string) {
  if (kind === "suggestion") return (await db.prospectSuggestion.findUnique({ where: { id }, select: { sellerId: true, name: true } })) ?? null;
  const a = await db.account.findUnique({ where: { id }, select: { sellerId: true, name: true } });
  return a ?? null;
}

/** Research: a new company becomes a company and is researched; a held account is researched again now. */
export async function researchRecAction(kind: "suggestion" | "account", id: string): Promise<ActionState> {
  const c = await clientOf(kind, id);
  if (!c) return { ok: false, message: "Not found" };
  await logAction("daily.research", kind === "account" ? { accountId: id } : { suggestionId: id });
  const { researchAllowed } = await import("@/lib/admin/research-clients");
  if (c.sellerId !== "test" && !(await researchAllowed(c.sellerId))) return { ok: false, message: "Live research is off for this client" };
  if (kind === "suggestion") {
    const { addSuggestion } = await import("@/lib/discover/scan");
    const accountId = await addSuggestion(id, await decider());
    if (!accountId) return { ok: false, message: "Couldn't add this company yet" };
    await markDecided(c.sellerId, id, "researched");
    await startBackgroundQueue();
    refresh("/discover", "/accounts");
    redirect(`/accounts/${accountId}`);
  }
  const { prepareReResearch } = await import("@/lib/pipeline/orchestrator");
  await prepareReResearch(id);
  await markDecided(c.sellerId, id, "researched");
  await startBackgroundQueue();
  refresh("/discover", `/accounts/${id}`);
  return { ok: true, message: `${c.name} is being researched again in the background` };
}

/** Snooze: hidden from the daily list for 7 or 30 days. */
export async function snoozeRecAction(kind: "suggestion" | "account", id: string, days: number): Promise<ActionState> {
  const c = await clientOf(kind, id);
  if (!c) return { ok: false, message: "Not found" };
  await logAction("daily.snooze", kind === "account" ? { accountId: id, detail: `${days} days` } : { suggestionId: id, detail: `${days} days` });
  const until = new Date(Date.now() + days * 86_400_000);
  if (kind === "suggestion") await db.prospectSuggestion.update({ where: { id }, data: { snoozedUntil: until } });
  else await logEvent(newContext(), { accountId: id, stage: 0, step: "daily.snooze", outcome: "info", reason: `Snoozed from Recommended today for ${days} days by ${(await decider()) ?? "a team member"}`, data: { until: until.toISOString() } });
  await markDecided(c.sellerId, id, `snoozed ${days} days`);
  refresh("/discover");
  return { ok: true, message: `Snoozed for ${days} days` };
}

/** Reject, with a reason. The reason teaches the ranking: similar ones are shown less. */
export async function rejectRecAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const kind = str(fd, "kind") === "account" ? "account" : "suggestion";
  const id = str(fd, "id") ?? "";
  const key = str(fd, "reason") ?? "other";
  const note = str(fd, "note");
  if (!(key in REJECT_REASONS)) return { ok: false, message: "Pick a reason" };
  const c = await clientOf(kind, id);
  if (!c) return { ok: false, message: "Not found" };
  await logAction("daily.reject", kind === "account" ? { accountId: id, detail: key } : { suggestionId: id, detail: key });
  const by = await decider();
  const reason = `${REJECT_REASONS[key]}${note ? `: ${note.slice(0, 200)}` : ""}`;
  if (kind === "suggestion") {
    const { dismissSuggestion } = await import("@/lib/discover/scan");
    await dismissSuggestion(id, by, reason);
    await db.prospectSuggestion.update({ where: { id }, data: { rejectReasonKey: key } });
  } else {
    // A held account isn't removed: it leaves the daily list for 90 days.
    await logEvent(newContext(), { accountId: id, stage: 0, step: "daily.reject", outcome: "info", reason: `Rejected from Recommended today by ${by ?? "a team member"}: ${reason}`, data: { until: new Date(Date.now() + 90 * 86_400_000).toISOString(), reasonKey: key } });
  }
  await markDecided(c.sellerId, id, "rejected");
  refresh("/discover");
  return { ok: true, message: `Rejected: ${REJECT_REASONS[key].toLowerCase()}. Similar companies will rank lower.` };
}

/** Build today's list again now for the client in view (managers). Searches only if live research is on. */
export async function runDailyNowAction(): Promise<ActionState> {
  await logAction("daily.run");
  const { activeSellerId } = await import("@/lib/scope");
  const id = await activeSellerId();
  const { dailyClients, runClientDaily } = await import("@/lib/discover/daily");
  if (!(await dailyClients()).includes(id)) return { ok: false, message: "Live research is off for this client, so the daily run doesn't search for it" };
  const { unscoped } = await import("@/lib/scope");
  const r = await unscoped(() => runClientDaily(id, newContext(), { force: true, budgetMs: 200_000 }));
  refresh("/discover", "/");
  return { ok: true, message: `Recommended today: ${r?.items ?? 0} accounts${r?.stopped ? ` (${r.stopped})` : ""}` };
}
