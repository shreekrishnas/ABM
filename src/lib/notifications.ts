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
  kind: "reply" | "approval" | "handoff" | "task" | "visitor" | "system" | "spend" | "error";
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
    me?.superAdmin ? monthlyStatus(now) : Promise.resolve(null),
    me?.superAdmin ? db.errorLog.findMany({ where: { lastSeen: { gte: new Date(now.getTime() - DAY) } }, orderBy: { lastSeen: "desc" }, take: 3, select: { id: true, source: true, message: true, count: true, lastSeen: true } }) : Promise.resolve([]),
  ]);
  const out: Notice[] = [];
  for (const r of replies) out.push({ id: `r-${r.id}`, kind: "reply", tone: r.class === "positive" ? "ok" : r.class === "unsubscribe" ? "bad" : "info", title: `${r.contact.fullName}${r.contact.account ? ` (${r.contact.account.name})` : ""} ${REPLY_WORD[r.class] ?? "replied"}`, detail: "Email reply", href: `/people/${r.contactId}`, at: r.receivedAt.toISOString() });
  for (const m of liReplies) out.push({ id: `l-${m.id}`, kind: "reply", tone: "ok", title: `${m.journey.contact.fullName}${m.journey.contact.account ? ` (${m.journey.contact.account.name})` : ""} replied on LinkedIn`, detail: "LinkedIn reply", href: `/people/${m.journey.contactId}`, at: m.createdAt.toISOString() });
  if (approvals) out.push({ id: `a-${approvals}`, kind: "approval", tone: "warn", title: `${approvals} draft${approvals === 1 ? "" : "s"} waiting for approval`, detail: oldestApproval ? `Oldest from ${oldestApproval.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "", href: "/review", at: (oldestApproval?.createdAt ?? now).toISOString() });
  for (const h of handoffs) out.push({ id: `h-${h.id}`, kind: "handoff", tone: "info", title: `${h.account.name} is ready for a rep`, detail: "Hand-off waiting", href: "/handoffs", at: h.createdAt.toISOString() });
  if (overdue) out.push({ id: `t-${overdue}`, kind: "task", tone: "warn", title: `${overdue} overdue task${overdue === 1 ? "" : "s"}`, detail: "Tasks", href: "/crm/tasks", at: now.toISOString() });
  if (visitors) out.push({ id: `v-${visitors}`, kind: "visitor", tone: "info", title: `${visitors} website visitor compan${visitors === 1 ? "y" : "ies"} waiting for approval`, detail: "Website visitors", href: "/import/apollo", at: now.toISOString() });
  if (paused) out.push({ id: `p-${paused.since.getTime()}`, kind: "system", tone: "warn", title: "AI is paused", detail: `Paused by ${paused.by}; research waits in the queue`, href: "/team?tab=system", at: paused.since.toISOString() });
  if (month) {
    const clients = await db.client.findMany({ select: { id: true, name: true } });
    for (const [id, m] of month) if (m.state !== "ok") out.push({ id: `s-${id}-${m.state}`, kind: "spend", tone: m.state === "over" ? "bad" : "warn", title: `${clients.find((c) => c.id === id)?.name ?? id}: ${m.state === "over" ? "monthly cap reached" : `${Math.round((m.share ?? 0) * 100)}% of monthly cap`}`, detail: `$${m.spent.toFixed(2)} of $${(m.cap ?? 0).toFixed(2)}`, href: "/team?tab=system", at: now.toISOString() });
  }
  for (const e of errors) out.push({ id: `e-${e.id}-${e.count}`, kind: "error", tone: "bad", title: `Error in ${e.source}${e.count > 1 ? ` (${e.count}×)` : ""}`, detail: e.message.slice(0, 120), href: "/team?tab=system", at: e.lastSeen.toISOString() });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25);
}
