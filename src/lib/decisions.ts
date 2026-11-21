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

export { DECISION_FILTER_LABEL, DECISION_FILTER_HELP } from "./decision-labels";

/**
 * "Waiting for you": the one count of everything a person must settle (every open review item),
 * split the same way on every screen (Engage badge, Home, Today, Approvals, Vega):
 * checks + sign-offs = total, and emails to approve (email drafts) are part of the sign-offs.
 */
export interface Waiting { total: number; checks: number; signOffs: number; emails: number; byType: Partial<Record<ReviewType, number>> }

export function summarizeWaiting(groups: { type: ReviewType; _count: number }[]): Waiting {
  const w: Waiting = { total: 0, checks: 0, signOffs: 0, emails: 0, byType: {} };
  for (const g of groups) {
    w.total += g._count;
    w.byType[g.type] = (w.byType[g.type] ?? 0) + g._count;
    if (decisionKind(g.type) === "approval") w.signOffs += g._count;
    else w.checks += g._count;
    if (g.type === "draft_approval") w.emails += g._count;
  }
  return w;
}

/** One query, scoped to the client(s) in view like every other read. */
export async function waitingForYou(): Promise<Waiting> {
  const groups = await db.reviewItem.groupBy({ by: ["type"], where: { status: "open" }, _count: true });
  return summarizeWaiting(groups as { type: ReviewType; _count: number }[]);
}

/** "29 checks · 5 sign-offs (3 emails)": the same wording wherever the total is broken down. */
export function waitingNote(w: Waiting): string {
  if (!w.total) return "Nothing waiting";
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return `${n(w.checks, "check", "checks")} · ${n(w.signOffs, "sign-off", "sign-offs")}${w.signOffs ? ` (${n(w.emails, "email", "emails")})` : ""}`;
}

/** Open decisions for one filter (oldest first) and the counts behind each filter. */
export async function openDecisions(filter: DecisionFilter, take = 6): Promise<{ items: Decision[]; counts: Record<DecisionFilter, number>; waiting: Waiting }> {
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
  const w = summarizeWaiting(groups as { type: ReviewType; _count: number }[]);
  const counts: Record<DecisionFilter, number> = { all: w.total, exception: w.checks, approval: w.signOffs };
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
  return { items, counts, waiting: w };
}
