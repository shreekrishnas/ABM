"use server";

import { db } from "@/lib/db";
import { logAction, refresh } from "@/lib/action-utils";
import { newContext } from "@/lib/pipeline/context";
import { unscoped } from "@/lib/scope";
import type { ActionState } from "@/app/actions";

/** Search the contact provider for the stakeholder groups nobody covers yet (approved companies, T1/T2). */
export async function searchStakeholdersAction(accountId: string): Promise<ActionState> {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, message: "Company not found" };
  await logAction("influencers.find", { accountId });
  const { expandStakeholders } = await import("@/lib/buying-group/expand");
  const r = await unscoped(() => expandStakeholders(account, newContext(), { force: true }));
  refresh(`/accounts/${accountId}`);
  if (!r.searched.length) return { ok: false, message: r.reason ?? "Every target group already has someone" };
  return { ok: true, message: `Searched ${r.searched.length} group${r.searched.length === 1 ? "" : "s"}: ${r.added} ${r.added === 1 ? "person" : "people"} added${r.reason ? `; stopped: ${r.reason}` : ""}` };
}

/** Ask the AI for 3–4 less-obvious people the company's facts point to, then look them up by title. */
export async function findInfluencersAction(accountId: string): Promise<ActionState> {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, message: "Company not found" };
  await logAction("influencers.find", { accountId });
  const { findHiddenInfluencers } = await import("@/lib/buying-group/expand");
  const r = await unscoped(() => findHiddenInfluencers(account, newContext(), { force: true }));
  refresh(`/accounts/${accountId}`);
  if (!r.roles.length) return { ok: false, message: r.reason === "No facts yet" ? "No facts yet: research the company first" : r.reason ?? "No grounded roles found" };
  const found = r.roles.filter((x) => x.found.length).length;
  return { ok: true, message: `${r.roles.length} role${r.roles.length === 1 ? "" : "s"} proposed, ${found} found in the contact provider${r.dropped.length ? `; ${r.dropped.length} proposal(s) left out` : ""}${r.reason ? `; lookups stopped: ${r.reason}` : ""}` };
}
