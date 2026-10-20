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

/**
 * A person corrects a fact: the corrected claim becomes a new verified fact (sourced, or
 * marked as a team correction), the old one is retired the same way as a wrong fact, and the
 * account's current twin shows the correction straight away.
 */
export async function correctFact(evidenceId: string, input: { claim: string; sourceUrl: string | null; by: string }) {
  const old = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
  const fresh = await db.evidence.create({
    data: {
      accountId: old.accountId, key: old.key, claim: input.claim.slice(0, 500), value: null,
      sourceUrl: input.sourceUrl || "https://team.correction/", sourceType: input.sourceUrl ? "official" : "team",
      publishedAt: new Date(), status: "verified", pass: "refresh", engine: "person", quote: null,
      isNegative: old.isNegative, negativeKind: old.negativeKind, sellerId: old.sellerId, sellerPackVersion: old.sellerPackVersion,
    },
  });
  await flagFact(evidenceId, `Corrected by ${input.by}`);
  await db.evidence.update({ where: { id: evidenceId }, data: { supersededById: fresh.id } });
  // Show it in the latest twin now; the next research run rebuilds the twin from evidence anyway.
  const twin = await db.twinVersion.findFirst({ where: { accountId: old.accountId }, orderBy: { version: "desc" } });
  if (twin) {
    const snap = twin.snapshot as unknown as { facts: { id: string; key: string; claim: string; status: string; sourceUrl: string; sourceType: string; publishedAt: string }[] };
    const entry = { id: fresh.id, key: fresh.key, claim: fresh.claim, status: "verified", sourceUrl: fresh.sourceUrl, sourceType: fresh.sourceType, publishedAt: fresh.publishedAt.toISOString() };
    const i = snap.facts.findIndex((f) => f.id === evidenceId);
    if (i >= 0) snap.facts[i] = entry;
    else snap.facts.unshift(entry);
    await db.twinVersion.update({ where: { id: twin.id }, data: { snapshot: snap as unknown as object } });
  }
  await logEvent(newContext(), { accountId: old.accountId, stage: 7, step: "brain.fact_corrected", outcome: "info", reason: `Corrected by ${input.by}: "${old.claim.slice(0, 60)}" → "${fresh.claim.slice(0, 60)}"` });
  return { accountId: old.accountId };
}
