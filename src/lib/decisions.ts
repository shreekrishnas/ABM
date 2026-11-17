// The Decision Center: every open review item, split into exceptions (a rule, check or source
// conflict a person settles) and approvals (something a person signs off or answers).
import type { ReviewType } from "@prisma/client";
import { db } from "@/lib/db";
import { reviewLabel } from "@/lib/review-labels";

export type DecisionKind = "exception" | "approval";
export type DecisionFilter = "all" | DecisionKind;

/** Complete on purpose: a new review type fails the type check until it is placed. */
export const DECISION_KIND: Record<ReviewType, DecisionKind> = {
  draft_approval: "approval",
  draft_refresh: "approval",
  needs_human_reply: "approval",
  other: "approval",
  identity_conflict: "exception",
  contradiction: "exception",
  guardrail_failed: "exception",
  budget_exceeded: "exception",
  no_usable_person: "exception",
  lawful_basis_missing: "exception",
  briefing_blocked: "exception",
  bounce_breaker: "exception",
  retry_exhausted: "exception",
  possible_blocker: "exception",
  proposed_rejection: "exception",
};

export const decisionKind = (t: string): DecisionKind => (DECISION_KIND as Record<string, DecisionKind>)[t] ?? "exception";

export const asDecisionFilter = (v: string | undefined): DecisionFilter => (v === "exception" || v === "approval" ? v : "all");

/** The review types a filter shows; undefined means every type. */
export function typesFor(f: DecisionFilter): ReviewType[] | undefined {
  if (f === "all") return undefined;
  return (Object.keys(DECISION_KIND) as ReviewType[]).filter((t) => DECISION_KIND[t] === f);
}

export interface Decision { id: string; type: ReviewType; kind: DecisionKind; label: string; title: string; description: string | null; href: string; createdAt: Date }

/** Open decisions for one filter (oldest first) and the counts behind each filter. */
export async function openDecisions(filter: DecisionFilter, take = 6): Promise<{ items: Decision[]; counts: Record<DecisionFilter, number> }> {
  const types = typesFor(filter);
  const [groups, rows] = await Promise.all([
    db.reviewItem.groupBy({ by: ["type"], where: { status: "open" }, _count: true }),
    db.reviewItem.findMany({
      where: { status: "open", ...(types ? { type: { in: types } } : {}) },
      orderBy: { createdAt: "asc" },
      take,
      include: { account: { select: { name: true } }, contact: { select: { fullName: true } } },
    }),
  ]);
  const counts: Record<DecisionFilter, number> = { all: 0, exception: 0, approval: 0 };
  for (const g of groups) {
    counts.all += g._count;
    counts[decisionKind(g.type)] += g._count;
  }
  const items = rows.map((r) => ({
    id: r.id,
    type: r.type,
    kind: decisionKind(r.type),
    label: reviewLabel(r.type),
    title: [r.contact?.fullName, r.account?.name].filter(Boolean).join(" · ") || reviewLabel(r.type),
    description: r.reason,
    href: `/review?type=${r.type}&pick=${r.id}`,
    createdAt: r.createdAt,
  }));
  return { items, counts };
}
