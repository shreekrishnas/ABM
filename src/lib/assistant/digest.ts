// The weekly digest: what happened in the last 7 days vs the 7 before, per client, straight from
// the database. No AI involved, so it works (and costs nothing) even while AI is paused.

import { baseDb } from "@/lib/db-base";
import type { Answer } from "./run";

const DAY = 86_400_000;
const pct = (now: number, before: number) => (before ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%` : now ? "new" : "no change");
const trend = (now: number, before: number) => `${now.toLocaleString()} (${pct(now, before)} vs the week before)`;

export async function weeklyDigest(now = new Date()): Promise<Answer> {
  const wk = new Date(now.getTime() - 7 * DAY);
  const prev = new Date(now.getTime() - 14 * DAY);
  const inWeek = { gte: wk, lt: now };
  const inPrev = { gte: prev, lt: wk };
  const clients = await baseDb.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } });
  const { monthlyStatus } = await import("@/lib/budget");
  const { stoppedGroups } = await import("@/lib/admin/ops");
  const { SENSITIVE, ACTION_WORD } = await import("@/lib/admin/audit");
  const [month, stopped] = await Promise.all([monthlyStatus(now), stoppedGroups()]);

  const facts: Answer["facts"] = [];
  const confirmed: string[] = [];
  const attention: string[] = [];
  const references: Answer["references"] = [];
  let totals = { added: 0, addedPrev: 0, sent: 0, sentPrev: 0, replies: 0, repliesPrev: 0 };

  for (const c of clients) {
    const acct = { sellerId: c.id };
    const viaContact = { contact: { account: acct } };
    const [added, addedPrev, researched, sent, sentPrev, replies, repliesPrev, positive, handoffs, oppsOpened, won, lost, waiting, overdue] = await Promise.all([
      baseDb.account.count({ where: { ...acct, mergedIntoId: null, createdAt: inWeek } }),
      baseDb.account.count({ where: { ...acct, mergedIntoId: null, createdAt: inPrev } }),
      baseDb.account.count({ where: { ...acct, mergedIntoId: null, pipelineStatus: "done", lastRunAt: inWeek } }),
      baseDb.message.count({ where: { ...viaContact, sentAt: inWeek } }),
      baseDb.message.count({ where: { ...viaContact, sentAt: inPrev } }),
      baseDb.reply.count({ where: { ...viaContact, receivedAt: inWeek } }),
      baseDb.reply.count({ where: { ...viaContact, receivedAt: inPrev } }),
      baseDb.reply.count({ where: { ...viaContact, receivedAt: inWeek, class: "positive" } }),
      baseDb.handoff.count({ where: { account: acct, createdAt: inWeek } }),
      baseDb.opportunity.count({ where: { account: acct, createdAt: inWeek } }),
      baseDb.opportunity.count({ where: { account: acct, stage: "won", closedAt: inWeek } }),
      baseDb.opportunity.count({ where: { account: acct, stage: "lost", closedAt: inWeek } }),
      baseDb.reviewItem.count({ where: { status: "open", OR: [{ account: acct }, { accountId: null, contact: { account: acct } }] } }),
      baseDb.task.count({ where: { account: acct, status: { in: ["todo", "in_progress"] }, dueAt: { lt: now } } }),
    ]);
    totals = { added: totals.added + added, addedPrev: totals.addedPrev + addedPrev, sent: totals.sent + sent, sentPrev: totals.sentPrev + sentPrev, replies: totals.replies + replies, repliesPrev: totals.repliesPrev + repliesPrev };
    const m = month.get(c.id);
    const stops = stopped.filter((g) => g.clientId === c.id);
    const stoppedCount = stops.reduce((t, g) => t + g.count, 0);
    const quiet = !added && !sent && !replies && !handoffs && !oppsOpened && !won && !lost && !researched;
    const status = c.status !== "active" ? ` (${c.status})` : "";
    confirmed.push(
      quiet
        ? `${c.name}${status}: a quiet week, nothing added, sent or received.`
        : `${c.name}${status}: ${added} companies added, ${researched} researched, ${sent} emails sent, ${replies} replies (${positive} positive), ${handoffs} hand-offs, ${oppsOpened} deals opened, ${won} won, ${lost} lost.`,
    );
    references.push({ type: "client", id: c.id, label: c.name });
    if (m?.state === "over") attention.push(`${c.name}: monthly cap reached ($${m.spent.toFixed(2)} of $${m.cap}); research is paused for it.`);
    else if (m?.state === "warn") attention.push(`${c.name}: ${Math.round((m.share ?? 0) * 100)}% of the monthly cap used ($${m.spent.toFixed(2)} of $${m.cap}).`);
    else if (m && m.cap == null && m.spent > 0) attention.push(`${c.name}: no monthly cap set ($${m.spent.toFixed(2)} spent this month).`);
    if (stoppedCount) attention.push(`${c.name}: ${stoppedCount} companies stopped; most often "${stops[0].reason.slice(0, 90)}" (${stops[0].count}).`);
    if (waiting) attention.push(`${c.name}: ${waiting} item${waiting === 1 ? "" : "s"} waiting for a person on Approvals.`);
    if (overdue) attention.push(`${c.name}: ${overdue} overdue task${overdue === 1 ? "" : "s"}.`);
  }

  const [errors, failedRuns, sensitive, signInFails] = await Promise.all([
    baseDb.errorLog.findMany({ where: { resolvedAt: null, lastSeen: inWeek }, orderBy: { lastSeen: "desc" }, take: 3, select: { id: true, message: true, count: true } }),
    baseDb.runLog.count({ where: { ok: false, finishedAt: inWeek } }).catch(() => 0),
    baseDb.auditEntry.findMany({ where: { action: { in: [...SENSITIVE] }, createdAt: inWeek }, orderBy: { createdAt: "desc" }, take: 5 }),
    baseDb.signInEvent.count({ where: { ok: false, createdAt: inWeek } }).catch(() => 0),
  ]);
  for (const e of errors) {
    attention.push(`Error ${e.count > 1 ? `(${e.count}×) ` : ""}not yet resolved: ${e.message.slice(0, 100)}`);
    references.push({ type: "error", id: e.id, label: e.message.slice(0, 60) });
  }
  if (failedRuns) attention.push(`${failedRuns} background run${failedRuns === 1 ? "" : "s"} failed this week (see System health → Run history).`);
  if (signInFails >= 5) attention.push(`${signInFails} failed sign-in attempts this week (see Security).`);

  facts.push(
    { label: "Companies added", value: trend(totals.added, totals.addedPrev) },
    { label: "Emails sent", value: trend(totals.sent, totals.sentPrev) },
    { label: "Replies", value: trend(totals.replies, totals.repliesPrev) },
    { label: "Spend this month", value: `$${[...month.values()].reduce((t, m) => t + m.spent, 0).toFixed(2)}` },
    { label: "Sensitive changes", value: String(sensitive.length) },
  );
  const changes = sensitive.map((s) => `${s.actorEmail} ${ACTION_WORD[s.action] ?? s.action}${s.target ? `: ${s.target}` : ""}`);

  const from = wk.toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return {
    title: `This week (${from} to ${to})`,
    summary: `${totals.added} companies added, ${totals.sent} emails sent and ${totals.replies} replies across ${clients.length} client${clients.length === 1 ? "" : "s"}. Counted straight from the records; no AI was used.`,
    facts,
    confirmed: [...confirmed, ...changes.map((c) => `Change: ${c}`)],
    possible: [],
    unknown: [],
    recommendedAction: attention.length ? `Needs attention:\n${attention.map((a) => `• ${a}`).join("\n")}` : "Nothing needs attention right now.",
    references,
  };
}
