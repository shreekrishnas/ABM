// "What's working": numbers about the parts of the program that run today (research and
// drafting), for the client in view. Each one answers a question a person can act on:
// where companies get stuck and why, which emails the team approves, rejects or rewrites,
// what it costs per approved email and how long approvals wait.

import { db } from "@/lib/db";
import { isTriggerKey } from "@/lib/research/keys";
import { SPEND_KINDS } from "@/lib/metrics";

const DAY = 86_400_000;

export interface Funnel { label: string; value: number; note?: string }
export interface Row { label: string; total: number; approved: number; edited: number; rejected: number; pending: number }

export interface Working {
  days: number;
  funnel: Funnel[];
  stops: { reason: string; count: number }[];
  drafts: { written: number; approved: number; approvedAsIs: number; edited: number; rejected: number; pending: number; blocked: number; replaced: number };
  rejections: { reason: string; count: number }[];
  byShape: Row[];
  byUseCase: Row[];
  cost: { total: number; perResearched: number | null; perApproved: number | null };
  wait: { medianHours: number | null; oldestPendingDays: number | null; reviewed: number };
  visitors: { companies: number; waiting: number; added: number };
}

/** Group reasons like "Too small (430 employees; must be more than 5,000)" under "Too small". */
export function reasonGroup(r: string): string {
  const t = r.replace(/\s+/g, " ").trim();
  const head = t.split(/ \(|: | — | - |;/)[0].trim();
  return (head.length >= 6 ? head : t).slice(0, 80);
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function working(now = new Date(), days = 30): Promise<Working> {
  const since = new Date(now.getTime() - days * DAY);
  const [added, accounts, drafts, stopEvents, spend, visits, visitorSuggestions] = await Promise.all([
    db.account.count({ where: { mergedIntoId: null, createdAt: { gte: since } } }),
    db.account.findMany({
      where: { mergedIntoId: null, OR: [{ createdAt: { gte: since } }, { lastRunAt: { gte: since } }] },
      select: { id: true, pipelineStatus: true, evidence: { where: { status: { in: ["verified", "probable"] } }, select: { key: true } }, contacts: { where: { readiness: "ready" }, select: { id: true } } },
    }),
    db.draft.findMany({ where: { createdAt: { gte: since } }, select: { id: true, status: true, reviewerNote: true, reviewedAt: true, createdAt: true, brief: true, useCase: true } }),
    db.pipelineEvent.findMany({ where: { step: { in: ["orchestrator.stop", "orchestrator.budget"] }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { accountId: true, reason: true } }),
    db.ledgerEntry.aggregate({ where: { createdAt: { gte: since }, kind: { in: [...SPEND_KINDS] as never } }, _sum: { amountMicros: true } }),
    db.webVisit.findMany({ where: { occurredAt: { gte: since }, OR: [{ companyName: { not: null } }, { accountId: { not: null } }] }, select: { companyName: true, companyDomain: true, accountId: true } }),
    db.prospectSuggestion.findMany({ where: { origin: "website_visitor", createdAt: { gte: since } }, select: { status: true } }),
  ]);

  const researched = accounts.filter((a) => a.evidence.some((e) => isTriggerKey(e.key))).length;
  const withPeople = accounts.filter((a) => a.contacts.length > 0).length;

  // Drafts: what the team did with them.
  const edited = (d: { reviewerNote: string | null }) => Boolean(d.reviewerNote?.includes("Edited by reviewer"));
  const auto = (d: { reviewerNote: string | null }) => Boolean(d.reviewerNote?.startsWith("Withdrawn"));
  const counted = drafts.filter((d) => d.status !== "needs_refresh");
  const approvedList = counted.filter((d) => d.status === "approved" || d.status === "sent");
  const rejectedList = counted.filter((d) => d.status === "rejected" && !auto(d));
  const ds = {
    written: counted.length,
    approved: approvedList.length,
    approvedAsIs: approvedList.filter((d) => !edited(d)).length,
    edited: approvedList.filter(edited).length,
    rejected: rejectedList.length,
    pending: counted.filter((d) => d.status === "pending_review").length,
    blocked: counted.filter((d) => d.status === "blocked").length,
    replaced: drafts.filter((d) => d.status === "needs_refresh").length,
  };

  // Why the team rejects: the reviewer's note (the edit marker aside).
  const rej = new Map<string, number>();
  for (const d of rejectedList) {
    const note = (d.reviewerNote ?? "").split(" · ").filter((x) => x !== "Edited by reviewer").join(" · ").trim() || "No reason given";
    rej.set(reasonGroup(note), (rej.get(reasonGroup(note)) ?? 0) + 1);
  }

  // Which shapes and use cases the team approves.
  const tally = (key: (d: (typeof counted)[number]) => string | null) => {
    const m = new Map<string, Row>();
    for (const d of counted) {
      const k = key(d);
      if (!k || d.status === "blocked") continue;
      const r = m.get(k) ?? { label: k, total: 0, approved: 0, edited: 0, rejected: 0, pending: 0 };
      r.total++;
      if (d.status === "approved" || d.status === "sent") {
        r.approved++;
        if (edited(d)) r.edited++;
      } else if (d.status === "rejected" && !auto(d)) r.rejected++;
      else if (d.status === "pending_review") r.pending++;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const brief = (d: { brief: unknown }) => (d.brief ?? {}) as { shape?: { label?: string }; focus?: { useCase?: string } | null; whyUs?: { useCase?: string | null } };

  // Where companies stop, by reason (latest stop per company).
  const seen = new Set<string>();
  const stops = new Map<string, number>();
  for (const e of stopEvents) {
    if (!e.accountId || seen.has(e.accountId)) continue;
    seen.add(e.accountId);
    const g = reasonGroup(e.reason ?? "No reason recorded");
    stops.set(g, (stops.get(g) ?? 0) + 1);
  }

  // How long drafts wait for a person.
  const waits = drafts.filter((d) => d.reviewedAt && !auto(d)).map((d) => (d.reviewedAt!.getTime() - d.createdAt.getTime()) / 3_600_000);
  const oldest = drafts.filter((d) => d.status === "pending_review").reduce<Date | null>((a, d) => (!a || d.createdAt < a ? d.createdAt : a), null);

  const total = (spend._sum.amountMicros ?? 0) / 1e6;
  const visitorCos = new Set(visits.map((v) => v.accountId ?? v.companyDomain ?? v.companyName ?? ""));
  visitorCos.delete("");

  return {
    days,
    funnel: [
      { label: "Companies added", value: added },
      { label: "Found a reason to reach out", value: researched, note: "a verified or probable buying trigger" },
      { label: "Have the right person", value: withPeople, note: "at least one contact ready" },
      { label: "Emails written", value: ds.written },
      { label: "Emails approved", value: ds.approved },
    ],
    stops: [...stops].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    drafts: ds,
    rejections: [...rej].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    byShape: tally((d) => brief(d).shape?.label ?? null),
    byUseCase: tally((d) => brief(d).focus?.useCase ?? brief(d).whyUs?.useCase ?? d.useCase?.replace(/_/g, " ") ?? null),
    cost: { total, perResearched: researched ? total / researched : null, perApproved: ds.approved ? total / ds.approved : null },
    wait: { medianHours: median(waits), oldestPendingDays: oldest ? (now.getTime() - oldest.getTime()) / DAY : null, reviewed: waits.length },
    visitors: { companies: visitorCos.size, waiting: visitorSuggestions.filter((s) => s.status === "new").length, added: visitorSuggestions.filter((s) => s.status === "added").length },
  };
}
