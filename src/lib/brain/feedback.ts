// Human feedback the brain learns from. A fact marked wrong stops being usable at
// once, and any unsent draft that cites it is withdrawn.

import { db } from "@/lib/db";
import { logEvent, newContext } from "@/lib/pipeline/context";
import type { Claim } from "@/lib/pipeline/gates";

export async function flagFact(evidenceId: string, reason: string) {
  const e = await db.evidence.update({ where: { id: evidenceId }, data: { flagged: true, flagReason: reason.slice(0, 300), status: "invalid" } });
  const drafts = await db.draft.findMany({ where: { contact: { accountId: e.accountId }, status: { in: ["pending_review", "approved"] }, message: null }, select: { id: true, claims: true } });
  const ids = drafts.filter((d) => ((d.claims ?? []) as unknown as Claim[]).some((c) => c.factIds?.includes(evidenceId))).map((d) => d.id);
  if (ids.length) {
    await db.draft.updateMany({ where: { id: { in: ids } }, data: { status: "rejected", reviewerNote: `Withdrawn — cited fact marked wrong: ${reason.slice(0, 120)}` } });
    await db.reviewItem.updateMany({ where: { draftId: { in: ids }, status: "open" }, data: { status: "resolved", resolution: "withdrawn (fact marked wrong)", resolvedAt: new Date() } });
  }
  await logEvent(newContext(), { accountId: e.accountId, stage: 7, step: "brain.fact_flagged", outcome: "block", reason: `Marked wrong: "${e.claim.slice(0, 80)}" — ${reason.slice(0, 120)}${ids.length ? `; ${ids.length} draft(s) withdrawn` : ""}` });
  return { accountId: e.accountId, withdrawn: ids.length };
}

export async function unflagFact(evidenceId: string) {
  const e = await db.evidence.update({ where: { id: evidenceId }, data: { flagged: false, flagReason: null, status: "probable" } });
  await logEvent(newContext(), { accountId: e.accountId, stage: 7, step: "brain.fact_unflagged", outcome: "info", reason: `Restored: "${e.claim.slice(0, 80)}"` });
  return { accountId: e.accountId };
}
