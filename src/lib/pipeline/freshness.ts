// Evidence freshness gate. A draft's claims were checked when it was written; by the time
// a person approves it, or the scheduler sends it, a cited fact can have gone stale, been
// retired (superseded by a correction) or been marked wrong. Re-check at approval and at
// send. A draft that fails is never sent: it is marked needs_refresh, the company goes back
// to research, and a fresh version returns for approval. Approval never carries over.

import type { Draft } from "@prisma/client";
import { db } from "@/lib/db";
import { factGuardrail, type Claim } from "./gates";
import { logEvent, openReview, type RunContext } from "./context";

export interface FreshnessResult {
  ok: boolean;
  reason: string;
}

/** Re-check every fact a draft cites against what is known now. */
export async function checkDraftEvidence(draft: Pick<Draft, "claims">, now = new Date()): Promise<FreshnessResult> {
  const claims = (draft.claims ?? []) as unknown as Claim[];
  const ids = [...new Set(claims.flatMap((c) => c.factIds ?? []))];
  const facts = ids.length ? await db.evidence.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, publishedAt: true, key: true, flagged: true, supersededById: true } }) : [];
  for (const f of facts) {
    if (f.flagged) return { ok: false, reason: "A cited fact was marked wrong" };
    if (f.supersededById) return { ok: false, reason: "A cited fact was replaced by a newer or corrected one" };
  }
  const g = factGuardrail(claims, facts, now);
  return { ok: g.pass, reason: g.pass ? "Every cited fact is still usable and fresh" : g.reason };
}

/**
 * Take a draft out of the send path and ask for a fresh one: status needs_refresh, its
 * approval review closed, a refresh review opened, and the company queued for research
 * again (later sequence steps are re-drafted when their enrollment comes due).
 */
export async function markNeedsRefresh(draftId: string, reason: string, ctx: RunContext, at: "approval" | "send") {
  const d = await db.draft.findUnique({ where: { id: draftId }, include: { contact: true } });
  if (!d || d.status === "needs_refresh" || d.status === "sent") return;
  await db.draft.update({ where: { id: d.id }, data: { status: "needs_refresh", blockReason: `${at === "send" ? "Held at send" : "Held at approval"}: ${reason}` } });
  await db.reviewItem.updateMany({ where: { draftId: d.id, status: "open" }, data: { status: "resolved", resolution: `Needs refresh: ${reason}`, resolvedAt: ctx.now } });
  await openReview({ type: "draft_refresh", stage: 11, accountId: d.contact.accountId, contactId: d.contactId, draftId: d.id, reason: `Step ${d.stepOrder} for ${d.contact.fullName} held at ${at}: ${reason}. A fresh version will come back for approval.` });
  if (d.stepOrder > 1) {
    // Later steps are drafted by the sequence ticker: make this step due again.
    await db.enrollment.updateMany({ where: { contactId: d.contactId, status: "active", currentStep: d.stepOrder }, data: { nextDueAt: ctx.now } });
  }
  await db.account.updateMany({ where: { id: d.contact.accountId, pipelineStatus: { notIn: ["running", "queued"] } }, data: { pipelineStatus: "queued", queuedFromStage: 5, followupUsed: false, reopenUsed: false } });
  await logEvent(ctx, { accountId: d.contact.accountId, contactId: d.contactId, stage: 11, step: "draft_review.freshness", outcome: "block", reason: `Step ${d.stepOrder} held at ${at}: ${reason} — re-researching, new version goes to review` });
}
