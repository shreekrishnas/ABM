// Level 3: JARVIS prepares the decision, a person makes it. Each email waiting for approval gets
// a strength (strong / fair / weak), a recommendation and the reasons, from what the pipeline
// already checked. Approving still goes through the existing guarded approval path.
import { db } from "@/lib/db";
import { checkDraftEvidence } from "@/lib/pipeline/freshness";

export type Strength = "strong" | "fair" | "weak";
export interface Assessment { draftId: string; contactId: string; accountId: string; person: string; title: string | null; company: string; tier: string | null; subject: string; strength: Strength; score: number; recommendation: "approve" | "edit" | "reject"; reasons: string[]; waitingDays: number; reviewId: string | null }

type Critic = { critic: string; pass: boolean; issues?: string[]; available?: boolean };

/** Score one waiting draft from the checks it already went through. Pure apart from the freshness lookup. */
export function scoreDraft(input: { critique: unknown; rewrites: number; claimsCount: number; leadEvidence: boolean; fresh: { ok: boolean; reason?: string }; tier: string | null; readiness: string | null }): { score: number; strength: Strength; recommendation: Assessment["recommendation"]; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;
  const critics = (Array.isArray(input.critique) ? input.critique : []) as Critic[];
  const failed = critics.filter((c) => c.available !== false && !c.pass);
  if (critics.length && !failed.length) { score += 20; reasons.push(`Passed all ${critics.length} quality checks`); }
  if (failed.length) { score -= 25; reasons.push(`Failed: ${failed.map((c) => c.critic).join(", ")}`); }
  if (input.rewrites === 0) { score += 5; reasons.push("Right first time"); } else if (input.rewrites >= 2) { score -= 10; reasons.push(`Needed ${input.rewrites} rewrites`); }
  if (input.leadEvidence) { score += 10; reasons.push("Opens with a sourced fact"); } else { score -= 5; reasons.push("No sourced opening fact"); }
  if (input.claimsCount > 0) score += 5;
  if (!input.fresh.ok) { score -= 40; reasons.push(`Evidence problem: ${input.fresh.reason ?? "stale"}`); } else reasons.push("Evidence is current");
  if (input.tier === "T1") score += 5;
  if (input.readiness && input.readiness !== "ready") { score -= 10; reasons.push(`Person is marked ${input.readiness.replaceAll("_", " ")}`); }
  score = Math.max(0, Math.min(100, score));
  const strength: Strength = !input.fresh.ok || failed.length ? "weak" : score >= 75 ? "strong" : score >= 55 ? "fair" : "weak";
  const recommendation = !input.fresh.ok ? "reject" : strength === "strong" ? "approve" : "edit";
  return { score, strength, recommendation, reasons };
}

/** Every email waiting for approval in the client in scope, strongest first. */
export async function recommendedApprovals(limit = 30, now = new Date()): Promise<Assessment[]> {
  const drafts = await db.draft.findMany({
    where: { status: "pending_review" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, subject: true, claims: true, critique: true, rewrites: true, leadEvidenceId: true, createdAt: true, contact: { select: { id: true, fullName: true, titleNormalized: true, title: true, readiness: true, account: { select: { id: true, name: true, tier: true } } } } },
  });
  const reviews = await db.reviewItem.findMany({ where: { draftId: { in: drafts.map((d) => d.id) }, status: "open" }, select: { id: true, draftId: true } });
  const reviewOf = new Map(reviews.map((r) => [r.draftId, r.id]));
  const out: Assessment[] = [];
  for (const d of drafts) {
    const fresh = await checkDraftEvidence(d, now).catch(() => ({ ok: true }) as { ok: boolean; reason?: string });
    const s = scoreDraft({ critique: d.critique, rewrites: d.rewrites, claimsCount: Array.isArray(d.claims) ? d.claims.length : 0, leadEvidence: Boolean(d.leadEvidenceId), fresh, tier: d.contact.account.tier, readiness: d.contact.readiness });
    out.push({ draftId: d.id, contactId: d.contact.id, accountId: d.contact.account.id, person: d.contact.fullName, title: d.contact.titleNormalized ?? d.contact.title, company: d.contact.account.name, tier: d.contact.account.tier, subject: d.subject, waitingDays: Math.floor((now.getTime() - d.createdAt.getTime()) / 86_400_000), reviewId: reviewOf.get(d.id) ?? null, ...s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** How often people agreed with JARVIS's recommendation, from recorded decisions. */
export async function agreement(sellerId: string, days = 30) {
  const rows = await db.agentAction.findMany({ where: { sellerId, tool: "decide_draft", createdAt: { gte: new Date(Date.now() - days * 86_400_000) } }, select: { result: true } });
  const r = rows.map((x) => x.result as { recommendation?: string; decision?: string; edited?: boolean } | null).filter((x): x is { recommendation: string; decision: string; edited?: boolean } => Boolean(x?.recommendation && x?.decision));
  const agreed = r.filter((x) => (x.recommendation === "approve" && x.decision === "approve" && !x.edited) || (x.recommendation === "reject" && x.decision === "reject") || (x.recommendation === "edit" && (x.edited || x.decision === "reject")));
  const strongApproved = r.filter((x) => x.recommendation === "approve");
  return { decisions: r.length, agreedShare: r.length ? agreed.length / r.length : null, strongApprovedUnedited: strongApproved.length ? strongApproved.filter((x) => x.decision === "approve" && !x.edited).length / strongApproved.length : null, strongCount: strongApproved.length };
}

/** Keep a person's decision on a draft next to what JARVIS would have recommended. */
export async function recordDraftDecision(d: { id: string; contactId: string; critique: unknown; rewrites: number; claims: unknown; leadEvidenceId: string | null; sellerId: string | null }, decision: "approve" | "reject", edited: boolean) {
  const c = await db.contact.findUnique({ where: { id: d.contactId }, select: { readiness: true, accountId: true, account: { select: { tier: true, sellerId: true } } } });
  if (!c) return;
  const s = scoreDraft({ critique: d.critique, rewrites: d.rewrites, claimsCount: Array.isArray(d.claims) ? d.claims.length : 0, leadEvidence: Boolean(d.leadEvidenceId), fresh: { ok: true }, tier: c.account.tier, readiness: c.readiness });
  const { decider } = await import("@/lib/action-utils");
  const { baseDb } = await import("@/lib/db-base");
  await baseDb.agentAction.create({
    data: {
      sellerId: d.sellerId ?? c.account.sellerId, accountId: c.accountId, contactId: d.contactId, tool: "decide_draft", level: 3, actor: (await decider()) ?? "unknown", origin: "chat",
      reason: `${decision === "approve" ? (edited ? "Approved with edits" : "Approved") : "Rejected"} a ${s.strength} draft (JARVIS recommended: ${s.recommendation})`,
      evidenceIds: [], input: { draftId: d.id }, result: { recommendation: s.recommendation, strength: s.strength, decision, edited }, status: "done", idempotencyKey: `decide:${d.id}`, startedAt: new Date(), doneAt: new Date(),
    },
  }).catch(() => undefined);
}
