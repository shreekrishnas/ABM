// Buying-group coordination: one plan per company instead of parallel campaigns.
//
//   • Contact plan: people are ordered (champion first, then decision maker; within a role,
//     stronger personal intent and seniority first) and their start dates are staggered so
//     no more than N new people at a company start receiving email in any 7 days.
//   • Company limits at send time: at most one email per company per day, at most N new people per week.
//   • Company pauses: a decision maker's "not now" or any objection pauses the whole company,
//     withdraws unsent drafts, and resumes later (re-check date, or a person resumes it).

import type { Account, Contact } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { readIntent } from "@/lib/brain/intent";
import { logEvent, type RunContext } from "./context";

const DAY = 86_400_000;
const SENIORITY: Record<string, number> = { c_level: 0, vp: 1, director: 2, manager: 3, ic: 4 };
const C = CONFIG.coordination;
/** Days between new people starting, so any 7 days hold at most maxNewPeoplePerWeek starts. */
export const staggerDays = () => Math.ceil(7 / Math.max(1, C.maxNewPeoplePerWeek));
const COMPANY = "company:";

export function isPaused(a: Pick<Account, "outreachPausedUntil">, now: Date) {
  return Boolean(a.outreachPausedUntil && a.outreachPausedUntil > now);
}

/**
 * Order the company's ready people and give each a start date. People already in the plan
 * keep their place and date; new people join after the last start, staggered.
 */
export async function planBuyingGroup(account: Account, ready: Contact[], ctx: RunContext): Promise<Contact[]> {
  const planned = ready.filter((c) => c.planStartAt);
  const fresh = ready.filter((c) => !c.planStartAt);
  if (fresh.length) {
    const roleRank = (r: string) => {
      const i = (C.roleOrder as readonly string[]).indexOf(r);
      return i < 0 ? C.roleOrder.length : i;
    };
    const intent = new Map<string, number>();
    for (const c of fresh) intent.set(c.id, (await readIntent(account.id, ctx.now, c.id)).score);
    fresh.sort((a, b) => roleRank(a.buyingRole) - roleRank(b.buyingRole) || (intent.get(b.id) ?? 0) - (intent.get(a.id) ?? 0) || (SENIORITY[a.seniority ?? ""] ?? 9) - (SENIORITY[b.seniority ?? ""] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime());
    const all = await db.contact.findMany({ where: { accountId: account.id, planStartAt: { not: null } }, select: { planOrder: true, planStartAt: true } });
    let order = Math.max(0, ...all.map((c) => c.planOrder ?? 0));
    const lastStart = all.reduce<number | null>((m, c) => (c.planStartAt && (m == null || c.planStartAt.getTime() > m) ? c.planStartAt.getTime() : m), null);
    let next = lastStart == null ? ctx.now.getTime() : Math.max(ctx.now.getTime(), lastStart + staggerDays() * DAY);
    for (const c of fresh) {
      order++;
      const start = new Date(next);
      const role = c.buyingRole.replace("_", " ");
      const why = [`${role}${roleRank(c.buyingRole) === 0 ? " goes first" : ""}`, (intent.get(c.id) ?? 0) > 0 ? `personal intent ${intent.get(c.id)}` : null, c.seniority ? c.seniority.replace("_", "-") : null].filter(Boolean).join(" · ");
      await db.contact.update({ where: { id: c.id }, data: { planOrder: order, planStartAt: start, planReason: start.getTime() > ctx.now.getTime() ? `${why} · waits for the weekly limit (${C.maxNewPeoplePerWeek} new people a week)` : why } });
      await logEvent(ctx, { accountId: account.id, contactId: c.id, stage: 11, step: "buying_group.plan", outcome: "info", reason: `#${order} ${c.fullName}: ${why}; outreach starts ${start.toISOString().slice(0, 10)}` });
      next += staggerDays() * DAY;
    }
  }
  return db.contact.findMany({ where: { id: { in: [...planned, ...fresh].map((c) => c.id) } }, orderBy: { planOrder: "asc" } });
}

/** Company-level reason to hold an email right now, or null. Checked at send time. */
export async function companyHold(contact: Pick<Contact, "id" | "accountId">, now: Date): Promise<string | null> {
  const account = await db.account.findUniqueOrThrow({ where: { id: contact.accountId }, select: { outreachPausedUntil: true, outreachPauseReason: true } });
  if (isPaused(account, now)) return `Company paused until ${account.outreachPausedUntil!.toISOString().slice(0, 10)}: ${account.outreachPauseReason ?? "paused"}`;
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const today = await db.message.count({ where: { contact: { accountId: contact.accountId }, OR: [{ status: "delivered", sentAt: { gte: startOfDay } }, { status: "queued" }] } });
  if (today >= C.maxEmailsPerAccountPerDay) return `Company limit: ${C.maxEmailsPerAccountPerDay} email${C.maxEmailsPerAccountPerDay === 1 ? "" : "s"} per day already sent`;
  const emailedBefore = await db.message.count({ where: { contactId: contact.id, status: "delivered" } });
  if (!emailedBefore) {
    const firsts = await db.message.groupBy({ by: ["contactId"], where: { contact: { accountId: contact.accountId }, status: "delivered" }, _min: { sentAt: true } });
    const recent = firsts.filter((f) => f._min.sentAt && f._min.sentAt.getTime() > now.getTime() - 7 * DAY).length;
    if (recent >= C.maxNewPeoplePerWeek) return `Company limit: ${C.maxNewPeoplePerWeek} new people already started this week`;
  }
  return null;
}

/** Pause the whole company: colleagues' sequences pause and their unsent drafts are withdrawn. */
export async function pauseCompany(accountId: string, days: number, reason: string, ctx: RunContext, opts: { exceptContactId?: string } = {}) {
  const until = new Date(ctx.now.getTime() + days * DAY);
  await db.account.update({ where: { id: accountId }, data: { outreachPausedUntil: until, outreachPauseReason: reason } });
  const ids = (await db.contact.findMany({ where: { accountId, ...(opts.exceptContactId ? { id: { not: opts.exceptContactId } } : {}) }, select: { id: true } })).map((c) => c.id);
  const paused = await db.enrollment.updateMany({ where: { contactId: { in: ids }, status: "active" }, data: { status: "paused", pausedReason: `${COMPANY} ${reason}` } });
  const withdrawn = await db.draft.updateMany({ where: { contactId: { in: ids }, status: { in: ["pending_review", "approved"] }, message: null }, data: { status: "rejected", reviewerNote: `Withdrawn — company paused: ${reason}` } });
  await db.reviewItem.updateMany({ where: { accountId, type: "draft_approval", status: "open", contactId: { in: ids } }, data: { status: "dismissed", resolution: `Company paused: ${reason}`, resolvedAt: ctx.now } });
  await logEvent(ctx, { accountId, stage: 12, step: "buying_group.pause_company", outcome: "block", reason: `${reason} — company paused until ${until.toISOString().slice(0, 10)}; ${paused.count} sequence(s) paused, ${withdrawn.count} unsent draft(s) withdrawn` });
  return until;
}

/** Lift a company pause: sequences paused by it resume and their due step is drafted again. */
export async function resumeCompany(accountId: string, ctx: RunContext, by = "pause ended") {
  await db.account.update({ where: { id: accountId }, data: { outreachPausedUntil: null, outreachPauseReason: null } });
  const r = await db.enrollment.updateMany({ where: { contact: { accountId, state: { notIn: ["suppressed", "do_not_contact", "handed_off", "replied"] } }, status: "paused", pausedReason: { startsWith: COMPANY } }, data: { status: "active", pausedReason: null, nextDueAt: ctx.now } });
  await logEvent(ctx, { accountId, stage: 12, step: "buying_group.resume_company", outcome: "info", reason: `Company outreach resumed (${by}); ${r.count} sequence(s) active again` });
  return r.count;
}
