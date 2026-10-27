// Command Center numbers. Every number is counted from a recorded state or event, has a
// plain definition, and links to the records behind it. Nothing is estimated.

import { db } from "@/lib/db";

const live = { mergedIntoId: null };
const engagedContact = { OR: [{ state: { in: ["replied", "handed_off"] as ("replied" | "handed_off")[] } }, { signals: { some: { attributed: true } } }, { journeys: { some: { stage: { in: ["replied_neutral", "details_requested", "details_shared", "interested", "call_scheduled", "demo_scheduled", "opportunity", "closed_won"] as never[] } } } }] };

export interface Kpi { key: string; label: string; value: number; note: string; href: string; tone: "" | "warn" | "risk" | "up"; define: string }
export interface FunnelStep { key: string; label: string; value: number; href: string; define: string }
export interface Attention { kind: string; title: string; detail: string; href: string; at: Date; tone: "risk" | "warn" | "info" }

// Funnel steps are nested: each counts companies that also passed every step before it.
const STEPS = [
  { key: "imported", where: {} },
  { key: "qualified", where: { pipelineStage: { gte: 4 }, stage: { not: "DISQUALIFIED" as const } } },
  { key: "researched", where: { briefs: { some: {} } } },
  { key: "contactable", where: { contacts: { some: { mergedIntoId: null, state: { in: ["ready", "in_sequence", "replied", "handed_off"] as ("ready" | "in_sequence" | "replied" | "handed_off")[] } } } } },
  { key: "contacted", where: { contacts: { some: { OR: [{ messages: { some: { status: "delivered" as const } } }, { journeys: { some: { stage: { not: "not_contacted" as const } } } }] } } } },
  { key: "engaged", where: { contacts: { some: engagedContact } } },
  { key: "handoff", where: { handoffs: { some: {} } } },
  { key: "opportunity", where: { opportunities: { some: {} } } },
];
const nested = (i: number) => ({ ...live, AND: STEPS.slice(0, i + 1).map((s) => s.where) });

export interface FlowAccount { id: string; name: string; tier: string | null; reached: number; reason: string }

/** Why a company stopped where it did, in plain words (from its recorded state). */
function stopReason(a: { stage: string; pipelineStatus: string; outreachPausedUntil: Date | null }, now: Date): string {
  if (a.stage === "DISQUALIFIED") return "Ruled out";
  if (a.outreachPausedUntil && a.outreachPausedUntil > now) return "Paused";
  if (["WATCH", "RECYCLED"].includes(a.stage)) return "Watching";
  if (a.pipelineStatus === "error") return "Stopped on an error";
  if (["queued", "running"].includes(a.pipelineStatus)) return "In progress";
  if (a.pipelineStatus === "blocked") return "Blocked at a check";
  if (["MQA", "OPPORTUNITY", "CUSTOMER"].includes(a.stage)) return "With sales";
  return "Not reached yet";
}

/** Every company with the furthest funnel step it passed, for the interactive flow. */
export async function companyFlow(now = new Date()): Promise<{ steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[] }> {
  const sets = await Promise.all(STEPS.map((_, i) => db.account.findMany({ where: nested(i), select: { id: true }, take: 5000 }).then((r) => new Set(r.map((x) => x.id)))));
  const all = await db.account.findMany({ where: live, select: { id: true, name: true, tier: true, stage: true, pipelineStatus: true, outreachPausedUntil: true }, take: 5000 });
  const accounts = all.map((a) => {
    let reached = -1;
    for (let i = 0; i < sets.length; i++) if (sets[i].has(a.id)) reached = i;
    return { id: a.id, name: a.name, tier: a.tier, reached, reason: stopReason(a, now) };
  });
  const words = (await commandCenter(now)).funnel;
  return { steps: words.map((f) => ({ key: f.key, label: f.label, define: f.define })), accounts };
}

export async function commandCenter(now = new Date()) {
  const steps = await Promise.all(STEPS.map((_, i) => db.account.count({ where: nested(i) })));
  const [imported, qualified, researched, contactable, contacted, engaged, handedOff, opportunity] = steps;
  const [contactedAll, engagedAll, openOpps, oppValue, atRiskPaused, atRiskError, toApprove, refresh, overdueTasks, overdueHandoffs] = await Promise.all([
    db.account.count({ where: { ...live, ...STEPS[4].where } }),
    db.account.count({ where: { ...live, ...STEPS[5].where } }),
    db.opportunity.count({ where: { stage: { notIn: ["won", "lost"] } } }),
    db.opportunity.aggregate({ where: { stage: { notIn: ["won", "lost"] } }, _sum: { amountUsd: true } }),
    db.account.findMany({ where: { ...live, outreachPausedUntil: { gt: now } }, select: { id: true, name: true, outreachPauseReason: true, outreachPausedUntil: true, updatedAt: true }, take: 20 }),
    db.account.findMany({ where: { ...live, pipelineStatus: "error" }, select: { id: true, name: true, pipelineStatus: true, lastError: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.reviewItem.findMany({ where: { status: "open", type: { in: ["draft_refresh", "retry_exhausted", "needs_human_reply", "budget_exceeded", "bounce_breaker", "possible_blocker"] } }, include: { account: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.task.findMany({ where: { status: { in: ["todo", "in_progress"] }, dueAt: { lt: now } }, include: { account: { select: { name: true } } }, orderBy: { dueAt: "asc" }, take: 20 }),
    db.handoff.findMany({ where: { status: "open", acknowledgedAt: null, ackDueAt: { lt: now } }, include: { account: { select: { name: true } } }, take: 20 }),
  ]);

  const atRisk = atRiskPaused.length + atRiskError.length;
  const overdue = overdueTasks.length + overdueHandoffs.length;
  const kpis: Kpi[] = [
    { key: "qualified", label: "Qualified companies", value: qualified, note: imported ? `${Math.round((qualified / imported) * 100)}% of ${imported} imported` : "Nothing imported yet", href: "/accounts", tone: "", define: "Passed the targeting rule and fit check, not ruled out" },
    { key: "engaged", label: "Engaged buying groups", value: engagedAll, note: contactedAll ? `of ${contactedAll} contacted` : "No outreach yet", href: "/accounts/coverage", tone: engagedAll ? "up" : "", define: "At least one person replied, engaged after our email, or is in a logged LinkedIn conversation" },
    { key: "opps", label: "Open opportunities", value: openOpps, note: oppValue._sum.amountUsd ? `$${oppValue._sum.amountUsd.toLocaleString()} entered` : "No value entered", href: "/crm/opportunities", tone: "", define: "Opportunities not yet won or lost. Value only where a person entered it" },
    { key: "risk", label: "At risk", value: atRisk, note: atRisk ? `${atRiskPaused.length} paused · ${atRiskError.length} stuck` : "Nothing stuck", href: "#attention", tone: atRisk ? "risk" : "", define: "Companies with outreach paused (objection, not now) or research stopped on an error that retries didn't fix" },
    { key: "approve", label: "Waiting for approval", value: toApprove, note: refresh.some((r) => r.type === "draft_refresh") ? `${refresh.filter((r) => r.type === "draft_refresh").length} need a fresh version` : toApprove ? "Drafts checked, waiting for you" : "Nothing waiting", href: "/review", tone: toApprove ? "warn" : "", define: "Drafts that passed every check and wait for a person" },
    { key: "overdue", label: "Overdue", value: overdue, note: overdue ? `${overdueTasks.length} task${overdueTasks.length === 1 ? "" : "s"} · ${overdueHandoffs.length} hand-off${overdueHandoffs.length === 1 ? "" : "s"}` : "All on time", href: "/crm/tasks", tone: overdue ? "risk" : "", define: "Open tasks past their due date, and hand-offs past the response time" },
  ];

  const funnel: FunnelStep[] = [
    { key: "imported", label: "Imported", value: imported, href: "/accounts", define: "Every company in the workspace" },
    { key: "qualified", label: "Qualified", value: qualified, href: "/accounts", define: "Passed targeting and fit" },
    { key: "researched", label: "Researched", value: researched, href: "/accounts", define: "Has a sourced research brief" },
    { key: "contactable", label: "Contactable", value: contactable, href: "/accounts/coverage", define: "At least one person passed readiness (verified, lawful, not suppressed)" },
    { key: "contacted", label: "Contacted", value: contacted, href: "/outreach", define: "An email was delivered, or a LinkedIn step was logged" },
    { key: "engaged", label: "Engaged", value: engaged, href: "/accounts/coverage", define: "A person replied or engaged (LinkedIn: only what was logged)" },
    { key: "handoff", label: "Handed to sales", value: handedOff, href: "/handoffs", define: "A hand-off was created" },
    { key: "opportunity", label: "Opportunity", value: opportunity, href: "/crm/opportunities", define: "An opportunity record exists" },
  ];

  const attention: Attention[] = [
    ...overdueHandoffs.map((h): Attention => ({ kind: "Hand-off overdue", title: h.account.name, detail: "Sales hasn't responded within the agreed time", href: "/handoffs", at: h.ackDueAt ?? now, tone: "risk" })),
    ...refresh.map((r): Attention => ({ kind: r.type === "draft_refresh" ? "Needs a fresh version" : r.type === "retry_exhausted" ? "Research keeps failing" : r.type === "needs_human_reply" ? "Reply needs a person" : r.type === "bounce_breaker" ? "Sending stopped: bounces" : r.type === "possible_blocker" ? "Possible blocker: you decide" : "Budget reached", title: r.account?.name ?? "All companies", detail: r.reason, href: r.accountId ? `/accounts/${r.accountId}` : "/review", at: r.createdAt, tone: r.type === "draft_refresh" ? "warn" : "risk" })),
    ...atRiskPaused.map((a): Attention => ({ kind: "Outreach paused", title: a.name, detail: `${a.outreachPauseReason ?? "Paused"} · until ${a.outreachPausedUntil!.toISOString().slice(0, 10)}`, href: `/accounts/${a.id}?tab=people`, at: a.updatedAt, tone: "warn" })),
    ...atRiskError.map((a): Attention => ({ kind: "Research stopped on an error", title: a.name, detail: a.lastError ?? "Open the audit trail for the reason", href: `/accounts/${a.id}?tab=pipeline`, at: a.updatedAt, tone: "risk" })),
    ...overdueTasks.map((t): Attention => ({ kind: "Task overdue", title: t.title, detail: t.account?.name ?? "", href: "/crm/tasks", at: t.dueAt ?? now, tone: "info" })),
  ].sort((a, b) => (a.tone === b.tone ? b.at.getTime() - a.at.getTime() : a.tone === "risk" ? -1 : b.tone === "risk" ? 1 : a.tone === "warn" ? -1 : 1));

  return { kpis, funnel, attention, freshAt: now };
}
