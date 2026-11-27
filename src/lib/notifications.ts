// The notification centre: what happened that a person should know about, built from records
// the platform already keeps (replies, approvals, hand-offs, tasks, visitors, spend, errors).
// Nothing is stored; "unread" is tracked in the browser by the time the panel was last opened.

import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { aiPause } from "@/lib/admin/ai-pause";
import { monthlyStatus } from "@/lib/budget";

const DAY = 86_400_000;

export interface Notice {
  id: string;
  kind: "reply" | "approval" | "handoff" | "task" | "visitor" | "system" | "spend" | "error" | "security";
  tone: "ok" | "warn" | "bad" | "info";
  title: string;
  detail: string;
  href: string;
  at: string;
}

const REPLY_WORD: Record<string, string> = { positive: "replied with interest", objection: "raised an objection", not_now: "asked to talk later", unsubscribe: "asked to stop", wrong_person: "pointed to someone else", out_of_office: "is out of office", needs_human: "replied" };

export async function notifications(now = new Date()): Promise<Notice[]> {
  const me = await getMe();
  const since = new Date(now.getTime() - 7 * DAY);
  const [replies, liReplies, approvals, oldestApproval, handoffs, overdue, visitors, paused, month, errors] = await Promise.all([
    db.reply.findMany({ where: { receivedAt: { gte: since }, class: { not: "out_of_office" } }, orderBy: { receivedAt: "desc" }, take: 8, select: { id: true, class: true, receivedAt: true, contactId: true, contact: { select: { fullName: true, account: { select: { name: true } } } } } }),
    db.linkedInMessage.findMany({ where: { direction: "in", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, createdAt: true, journey: { select: { contactId: true, contact: { select: { fullName: true, account: { select: { name: true } } } } } } } }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.draft.findFirst({ where: { status: "pending_review" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.handoff.findMany({ where: { acknowledgedAt: null, blocked: false }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, createdAt: true, account: { select: { id: true, name: true } } } }),
    db.task.count({ where: { status: { in: ["todo", "in_progress"] }, dueAt: { lt: now } } }),
    db.prospectSuggestion.count({ where: { origin: "website_visitor", status: "new" } }),
    aiPause(),
    me?.fullSuperAdmin ? monthlyStatus(now) : Promise.resolve(null),
    me?.fullSuperAdmin ? db.errorLog.findMany({ where: { lastSeen: { gte: new Date(now.getTime() - DAY) } }, orderBy: { lastSeen: "desc" }, take: 3, select: { id: true, source: true, message: true, count: true, lastSeen: true } }) : Promise.resolve([]),
  ]);
  const out: Notice[] = [];
  // What Vega did on its own in reaction to events (Level 2): it acts, then tells you here.
  const acted = await db.agentAction.findMany({ where: { level: 2, status: { in: ["done", "undone"] }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, tool: true, reason: true, status: true, createdAt: true, sellerId: true, accountId: true } }).catch(() => []);
  const URGENT = new Set(["opt_out_everywhere", "budget_brake"]);
  const DID: Record<string, string> = { opt_out_everywhere: "stopped all outreach to them", hot_reply_handoff: "gave the owner a task to reply within 24h", question_task: "gave the owner a task to answer", ooo_reschedule: "moved the next step to after their return", find_replacement: "is looking for someone in the same role", meeting_prep: "added a prep task", budget_brake: "paused its own paid work for this client" };
  for (const a of acted) out.push({ id: `j-${a.id}`, kind: "system", tone: URGENT.has(a.tool) ? "bad" : "info", title: `Vega: ${a.reason}`, detail: `${a.status === "undone" ? "Undone · " : ""}It ${DID[a.tool] ?? "acted"}`, href: `/vega?c=${a.sellerId}${a.accountId ? `&a=${a.accountId}` : ""}`, at: a.createdAt.toISOString() });
  for (const r of replies) out.push({ id: `r-${r.id}`, kind: "reply", tone: r.class === "positive" ? "ok" : r.class === "unsubscribe" ? "bad" : "info", title: `${r.contact.fullName}${r.contact.account ? ` (${r.contact.account.name})` : ""} ${REPLY_WORD[r.class] ?? "replied"}`, detail: "Email reply", href: `/people/${r.contactId}`, at: r.receivedAt.toISOString() });
  for (const m of liReplies) out.push({ id: `l-${m.id}`, kind: "reply", tone: "ok", title: `${m.journey.contact.fullName}${m.journey.contact.account ? ` (${m.journey.contact.account.name})` : ""} replied on LinkedIn`, detail: "LinkedIn reply", href: `/people/${m.journey.contactId}`, at: m.createdAt.toISOString() });
  if (approvals) out.push({ id: `a-${approvals}`, kind: "approval", tone: "warn", title: `${approvals} draft${approvals === 1 ? "" : "s"} waiting for approval`, detail: oldestApproval ? `Oldest from ${oldestApproval.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "", href: "/review?type=draft_approval", at: (oldestApproval?.createdAt ?? now).toISOString() });
  for (const h of handoffs) out.push({ id: `h-${h.id}`, kind: "handoff", tone: "info", title: `${h.account.name} is ready for a rep`, detail: "Hand-off waiting", href: "/handoffs", at: h.createdAt.toISOString() });
  if (overdue) out.push({ id: `t-${overdue}`, kind: "task", tone: "warn", title: `${overdue} overdue task${overdue === 1 ? "" : "s"}`, detail: "Tasks", href: "/crm/tasks", at: now.toISOString() });
  if (visitors) out.push({ id: `v-${visitors}`, kind: "visitor", tone: "info", title: `${visitors} website visitor compan${visitors === 1 ? "y" : "ies"} waiting for approval`, detail: "Website visitors", href: "/import/apollo", at: now.toISOString() });
  // Budget stops are shown here (in the bell), not in "Needs attention".
  const budgetStops = await db.reviewItem.findMany({ where: { status: "open", type: "budget_exceeded" }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, reason: true, createdAt: true, accountId: true, account: { select: { name: true } } } });
  for (const b of budgetStops) out.push({ id: `b-${b.id}`, kind: "spend", tone: "warn", title: `${b.account?.name ?? "A company"}: budget reached`, detail: b.reason.slice(0, 160), href: `/review?type=budget_exceeded&pick=${b.id}`, at: b.createdAt.toISOString() });
  if (paused) out.push({ id: `p-${paused.since.getTime()}`, kind: "system", tone: "warn", title: "AI is paused", detail: "Research waits in the queue", href: "/team?tab=system", at: paused.since.toISOString() });
  if (month) {
    const clients = await db.client.findMany({ select: { id: true, name: true } });
    for (const [id, m] of month) if (m.state !== "ok") out.push({ id: `s-${id}-${m.state}`, kind: "spend", tone: m.state === "over" ? "bad" : "warn", title: `${clients.find((c) => c.id === id)?.name ?? id}: ${m.state === "over" ? "monthly cap reached" : `${Math.round((m.share ?? 0) * 100)}% of monthly cap`}`, detail: `$${m.spent.toFixed(2)} of $${(m.cap ?? 0).toFixed(2)}`, href: "/team?tab=system", at: now.toISOString() });
  }
  if (me?.fullSuperAdmin) {
    const { systemAlerts } = await import("@/lib/admin/alerts");
    for (const a of await systemAlerts(now)) out.push({ id: `al-${a.key}-${a.at.getTime()}`, kind: "system", tone: a.tone, title: a.title, detail: `${a.detail} ${a.fix}`, href: a.href, at: a.at.toISOString() });
    const { SENSITIVE, ACTION_WORD } = await import("@/lib/admin/audit");
    const changes = await db.auditEntry.findMany({ where: { action: { in: [...SENSITIVE] }, actorEmail: { not: me.email }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5 });
    for (const c of changes) out.push({ id: `x-${c.id}`, kind: "security", tone: "warn", title: `${c.actorEmail} ${ACTION_WORD[c.action] ?? c.action}`, detail: c.target ?? "Sensitive change", href: "/team?tab=security", at: c.createdAt.toISOString() });
  }
  for (const e of errors) out.push({ id: `e-${e.id}-${e.count}`, kind: "error", tone: "bad", title: `Error in ${e.source}${e.count > 1 ? ` (${e.count}×)` : ""}`, detail: e.message.slice(0, 120), href: "/team?tab=system", at: e.lastSeen.toISOString() });
  const { prefsFor } = await import("@/lib/prefs");
  const mute = new Set<string>((await prefsFor(me?.email)).mute ?? []);
  const group = (k: Notice["kind"]) => (k === "spend" || k === "error" || k === "security" ? "system" : k);
  return out.filter((n) => !mute.has(group(n.kind))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25);
}
