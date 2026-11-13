"use server";

import { db } from "@/lib/db";
import { logAction, refresh } from "@/lib/action-utils";
import { unscoped } from "@/lib/scope";
import type { ActionState } from "@/app/actions";

/**
 * "Research this": search one open question again now (charged to the company's budget),
 * then rebuild the company's facts. The longer investigation is not re-run.
 */
export async function researchQuestionAction(accountId: string, key: string): Promise<ActionState> {
  // The scoped read is the access check.
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, message: "Company not found" };
  await logAction("research.question", { accountId, detail: key });
  // The Test client runs on stand-in services (never a real search); other clients need live research switched on.
  const sample = account.sellerId === "test";
  const { researchAllowed } = await import("@/lib/admin/research-clients");
  if (!sample && !(await researchAllowed(account.sellerId))) return { ok: false, message: "Live research is off for this client. A Super Admin can switch it on in the client's settings." };
  const { startJob } = await import("@/lib/jobs");
  const { decider } = await import("@/lib/action-utils");
  const { questionLabel } = await import("@/lib/research/keys");
  return startJob("research_question", { sellerId: account.sellerId, accountId, label: `Research ${account.name}: ${questionLabel(key)}`, params: { key }, createdBy: await decider() });
}

/** Two sources disagree: a person keeps one. The others are retired (kept for the record, never used). */
export async function keepFactAction(evidenceId: string): Promise<ActionState> {
  const win = await db.evidence.findUnique({ where: { id: evidenceId } });
  if (!win) return { ok: false, message: "Fact not found" };
  await logAction("fact.keep", { accountId: win.accountId, evidenceId });
  const others = await db.evidence.findMany({ where: { accountId: win.accountId, key: win.key, status: "conflicting", id: { not: win.id }, supersededById: null }, select: { id: true } });
  await db.evidence.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { supersededById: win.id, confidence: 0 } });
  await db.evidence.update({ where: { id: win.id }, data: { status: "verified" } });
  const ids = new Set([win.id, ...others.map((o) => o.id)]);
  const reviews = await db.reviewItem.findMany({ where: { accountId: win.accountId, type: "contradiction", status: "open" } });
  for (const r of reviews) {
    const p = (r.payload ?? {}) as { evidenceIds?: string[] };
    if (p.evidenceIds?.some((id) => ids.has(id))) await db.reviewItem.update({ where: { id: r.id }, data: { status: "resolved", resolution: "A person kept one source", resolvedAt: new Date() } });
  }
  refresh(`/accounts/${win.accountId}`, "/review");
  return { ok: true, message: "Kept. The other version is retired and won't be used." };
}

/** "Looks right": a person confirms the fact against its source. Click again to undo. */
export async function checkFactAction(evidenceId: string): Promise<ActionState> {
  const e = await db.evidence.findUnique({ where: { id: evidenceId } });
  if (!e) return { ok: false, message: "Fact not found" };
  await logAction("fact.check", { accountId: e.accountId, evidenceId });
  if (e.checkedAt) {
    await db.evidence.update({ where: { id: e.id }, data: { checkedAt: null, checkedBy: null, confidence: null } });
  } else {
    const { getMe } = await import("@/lib/me");
    const me = await getMe();
    await db.evidence.update({ where: { id: e.id }, data: { checkedAt: new Date(), checkedBy: me?.name ?? me?.email ?? "a team member", status: "verified", confidence: Math.max(90, e.confidence ?? 0) } });
  }
  // Statuses and confidence for the whole fact group follow.
  const { refreshStatuses } = await import("@/lib/pipeline/stages/research");
  await unscoped(() => refreshStatuses(e.accountId, new Date()));
  refresh(`/accounts/${e.accountId}`, "/pipeline");
  return { ok: true, message: e.checkedAt ? "Check removed" : "Marked as checked: counts as verified" };
}
