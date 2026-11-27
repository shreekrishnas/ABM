// The weekly report: one page a business owner can read in two minutes. The best accounts and why,
// what research found this week, which companies visited the website, and the drafts waiting for a
// decision. Read only from what is stored, within the clients in view (the scoped db client).

import { db } from "@/lib/db";
import type { TwinSnapshot } from "@/lib/pipeline/stages/research";
import { glanceFor, type Glance } from "@/lib/accounts/glance";

const DAY = 86_400_000;

export interface WeeklyReport {
  from: Date;
  to: Date;
  numbers: { added: number; researched: number; visitors: number; draftsWaiting: number; emailsSent: number; replies: number };
  top: { id: string; name: string; domain: string | null; tier: string | null; priority: number | null; glance: Glance }[];
  changes: { id: string; name: string; items: string[]; negatives: string[] }[];
  visitors: { name: string; domain: string | null; visits: number; lastAt: Date; accountId: string | null }[];
  drafts: { id: string; subject: string; person: string; title: string | null; company: string; accountId: string; createdAt: Date }[];
}

/** "New revenue: FY2025 …" → "Revenue: FY2025 …"; "employee_count now verified: …" → "Employee count (now confirmed): …". */
export function changeLine(c: string): string {
  const word = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());
  const added = c.match(/^New ([a-z0-9_]+):\s*([\s\S]*)$/);
  if (added) return `${word(added[1])}: ${added[2]}`;
  const moved = c.match(/^([a-z0-9_]+) now ([a-z_]+):\s*([\s\S]*)$/);
  if (moved) return `${word(moved[1])} (now ${moved[2] === "verified" ? "confirmed" : moved[2].replace(/_/g, " ")}): ${moved[3]}`;
  return c;
}

export async function weeklyReport(now = new Date(), days = 7): Promise<WeeklyReport> {
  const from = new Date(now.getTime() - days * DAY);
  const inWeek = { gte: from, lte: now };
  const live = { mergedIntoId: null };
  const [added, twins, visitGroups, draftsWaiting, emailsSent, replies, topAccounts, waiting] = await Promise.all([
    db.account.count({ where: { ...live, createdAt: inWeek } }),
    db.twinVersion.findMany({ where: { createdAt: inWeek, account: live }, orderBy: { createdAt: "desc" }, select: { accountId: true, snapshot: true, account: { select: { name: true } } } }),
    db.webVisit.groupBy({ by: ["companyName", "companyDomain"], where: { occurredAt: inWeek, OR: [{ companyName: { not: null } }, { companyDomain: { not: null } }] }, _count: true, _max: { occurredAt: true } }),
    db.draft.count({ where: { status: "pending_review", contact: { mergedIntoId: null } } }),
    db.message.count({ where: { sentAt: inWeek, status: { in: ["delivered", "bounced"] } } }),
    db.reply.count({ where: { receivedAt: inWeek, class: { not: "out_of_office" } } }),
    db.account.findMany({
      where: { ...live, stage: { notIn: ["DISQUALIFIED", "CUSTOMER"] }, doNotContact: false, priorityScore: { not: null } },
      orderBy: [{ priorityScore: "desc" }, { fitScore: "desc" }],
      take: 10,
      select: { id: true, name: true, domain: true, tier: true, priorityScore: true, stage: true, doNotContact: true, disqualifyReason: true, fitScore: true, intentReading: true },
    }),
    db.draft.findMany({ where: { status: "pending_review", contact: { mergedIntoId: null } }, orderBy: { createdAt: "asc" }, take: 8, select: { id: true, subject: true, createdAt: true, contact: { select: { fullName: true, title: true, account: { select: { id: true, name: true } } } } } }),
  ]);

  // One entry per company: its newest version this week (older ones in the same week repeat it).
  const changes: WeeklyReport["changes"] = [];
  const seen = new Set<string>();
  const researched = new Set<string>();
  for (const t of twins) {
    researched.add(t.accountId);
    if (seen.has(t.accountId)) continue;
    seen.add(t.accountId);
    const snap = t.snapshot as unknown as Partial<TwinSnapshot>;
    const items = (snap.changed ?? []).map(changeLine);
    const negatives = (snap.negatives ?? []).filter((n) => new Date(n.publishedAt) >= from).map((n) => n.claim);
    if (items.length || negatives.length) changes.push({ id: t.accountId, name: t.account.name, items: items.slice(0, 4), negatives: negatives.slice(0, 2) });
  }
  changes.sort((a, b) => b.negatives.length - a.negatives.length || b.items.length - a.items.length);

  const visitorsAll = visitGroups
    .map((g) => ({ name: g.companyName ?? g.companyDomain ?? "Unknown company", domain: g.companyDomain, visits: g._count, lastAt: g._max.occurredAt ?? now }))
    .sort((a, b) => b.visits - a.visits || b.lastAt.getTime() - a.lastAt.getTime());
  const topVisitors = visitorsAll.slice(0, 10);
  const domains = topVisitors.map((v) => v.domain).filter((d): d is string => Boolean(d));
  const known = domains.length ? await db.account.findMany({ where: { ...live, domain: { in: domains } }, select: { id: true, domain: true } }) : [];
  const accountOfDomain = new Map(known.map((k) => [k.domain, k.id]));

  const glances = await glanceFor(topAccounts);
  return {
    from,
    to: now,
    numbers: { added, researched: researched.size, visitors: visitorsAll.length, draftsWaiting, emailsSent, replies },
    top: topAccounts.map((a) => ({ id: a.id, name: a.name, domain: a.domain, tier: a.tier, priority: a.priorityScore, glance: glances.get(a.id)! })),
    changes: changes.slice(0, 10),
    visitors: topVisitors.map((v) => ({ ...v, accountId: v.domain ? accountOfDomain.get(v.domain) ?? null : null })),
    drafts: waiting.map((d) => ({ id: d.id, subject: d.subject, person: d.contact.fullName, title: d.contact.title, company: d.contact.account.name, accountId: d.contact.account.id, createdAt: d.createdAt })),
  };
}
