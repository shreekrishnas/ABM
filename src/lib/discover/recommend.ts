// "Recommended today": one ranked list per client per day. Candidates are new suggestions
// (companies we don't hold yet) and held accounts with a fresh signal. Each item says why it
// ranks where it does, shows its dated, quoted signals and what changed, and estimates what
// researching it would cost. A person decides: Research, Snooze or Reject.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { isTriggerKey, questionLabel } from "@/lib/research/keys";
import type { DailySettings } from "@/lib/seller/types";

const DAY = 86_400_000;

export interface RecSignal { text: string; quote: string | null; url: string | null; publisher: string | null; at: string | null; kind: string }
export interface RecItem {
  kind: "suggestion" | "account";
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employees: number | null;
  country: string | null;
  fit: number | null;
  intent: number;
  score: number;
  signals: RecSignal[];
  changed: string[];
  estCostUsd: number;
  why: string;
  /** Set when a person acts on it today: researched | snoozed | rejected. */
  decided?: string;
}

export const DAILY_DEFAULTS: Required<DailySettings> = { news: true, jobs: true, recheck: true, lookalikes: false, maxNew: 10, recheckPerDay: 10, jobAccountsPerDay: 40, maxUsd: 2 };
export const dailySettings = (d?: DailySettings): Required<DailySettings> => ({ ...DAILY_DEFAULTS, ...Object.fromEntries(Object.entries(d ?? {}).filter(([, v]) => v != null)) });

export const REJECT_REASONS: Record<string, string> = { wrong_industry: "Wrong industry or business", too_small: "Too small or wrong country", weak_signal: "Signal isn't a real buying reason", not_now: "Not now", already_known: "Already talking to them", other: "Other" };

/** The day as people in India read it (the daily check runs at 7:30 AM IST). */
export function istDate(d = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

const host = (u: string | null | undefined) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/** 100 for a signal from today, falling to 0 at 60 days. */
const recency = (at: Date | null, now: Date) => (at ? Math.max(0, 100 - ((now.getTime() - at.getTime()) / DAY) * (100 / 60)) : 0);

/**
 * What the team has been rejecting lately lowers the weight of more of the same: an industry
 * rejected as "wrong industry", or a kind of signal rejected as "not a real buying reason".
 */
async function rejectionPenalties(sellerId: string, now: Date) {
  const rows = await db.prospectSuggestion.findMany({ where: { sellerId, rejectReasonKey: { not: null }, decidedAt: { gte: new Date(now.getTime() - 90 * DAY) } }, select: { rejectReasonKey: true, bucket: true, sources: true } });
  const industry = new Map<string, number>();
  const trigger = new Map<string, number>();
  for (const r of rows) {
    if (r.rejectReasonKey === "wrong_industry") industry.set(r.bucket, (industry.get(r.bucket) ?? 0) + 1);
    if (r.rejectReasonKey === "weak_signal") for (const s of (r.sources as { trigger?: string }[] | null) ?? []) if (s.trigger) trigger.set(s.trigger, (trigger.get(s.trigger) ?? 0) + 1);
  }
  return {
    industry: (bucket: string) => Math.min(15, (industry.get(bucket) ?? 0) * 5),
    trigger: (keys: string[]) => Math.min(15, Math.max(0, ...keys.map((k) => (trigger.get(k) ?? 0) * 5))),
  };
}

/** Typical research cost for this client's companies (last 30 researched), else the cheapest tier's ceiling. */
async function typicalCost(sellerId: string): Promise<number> {
  const rows = await db.ledgerEntry.groupBy({ by: ["accountId"], where: { account: { sellerId }, accountId: { not: null }, createdAt: { gte: new Date(Date.now() - 60 * DAY) } }, _sum: { amountMicros: true }, orderBy: { _sum: { amountMicros: "desc" } }, take: 30 });
  const costs = rows.map((r) => (r._sum.amountMicros ?? 0) / 1e6).filter((c) => c > 0);
  if (!costs.length) return CONFIG.budgetsUsd.T3;
  costs.sort((a, b) => a - b);
  return Math.round(costs[Math.floor(costs.length / 2)] * 100) / 100;
}

/** Build (or rebuild) today's list for the active client. `changes` are "what changed" lines from today's re-checks. */
export async function buildDailyList(sellerId: string, settings: Required<DailySettings>, changes: Map<string, string[]>, now = new Date()): Promise<RecItem[]> {
  const [pen, cost] = await Promise.all([rejectionPenalties(sellerId, now), typicalCost(sellerId)]);
  const items: RecItem[] = [];

  // 1. Companies we don't hold yet.
  const sugg = await db.prospectSuggestion.findMany({
    where: { sellerId, status: "new", OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    orderBy: { score: "desc" }, take: 60,
  });
  for (const s of sugg) {
    const src = (s.sources as { url?: string; quote?: string; at?: string; trigger?: string; reports?: number; claim?: string; title?: string; kind?: string }[] | null) ?? [];
    const newest = src.map((x) => (x.at ? new Date(x.at) : null)).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? s.updatedAt;
    const fit = s.fitScore ?? null;
    const novelty = now.getTime() - newest.getTime() <= DAY || now.getTime() - s.createdAt.getTime() <= DAY ? 10 : 0;
    const penalty = pen.industry(s.bucket) + pen.trigger(src.map((x) => x.trigger ?? "").filter(Boolean));
    const score = Math.round(0.45 * (fit ?? s.score) + 0.35 * s.score + 0.2 * recency(newest, now) + novelty - penalty);
    items.push({
      kind: "suggestion", id: s.id, name: s.name, domain: s.domain, industry: s.industry, employees: s.employees, country: s.country, fit, intent: s.score, score,
      signals: src.slice(0, 3).map((x) => ({ text: x.title ?? x.claim ?? s.whyNow, quote: x.quote ?? null, url: x.url ?? null, publisher: host(x.url), at: x.at ?? null, kind: x.kind ?? (x.trigger ? x.trigger.replace(/^market:/, "").replace(/_/g, " ") : "news") })),
      changed: s.resurfacedAt && now.getTime() - s.resurfacedAt.getTime() <= 2 * DAY ? ["Back on new evidence after it was ignored"] : [],
      estCostUsd: cost,
      why: [`New company · ${s.level} intent ${s.score}`, fit != null ? `fit ${fit}` : null, novelty ? "new since yesterday" : null, penalty ? "similar ones were rejected lately" : null].filter(Boolean).join(" · "),
    });
  }

  // 2. Held accounts with a fresh signal (last 7 days), not already in outreach or with sales, not snoozed.
  const fresh = await db.evidence.findMany({
    where: { account: { sellerId, mergedIntoId: null, stage: { notIn: ["CUSTOMER", "OPPORTUNITY", "DISQUALIFIED", "MQA"] } }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) }, isNegative: false, flagged: false, supersededById: null, status: { in: ["verified", "probable"] } },
    orderBy: [{ confidence: "desc" }, { publishedAt: "desc" }],
    take: 300,
  });
  const byAccount = new Map<string, typeof fresh>();
  for (const e of fresh) if (isTriggerKey(e.key) || e.engine === "careers") byAccount.set(e.accountId, [...(byAccount.get(e.accountId) ?? []), e]);
  if (byAccount.size) {
    const accounts = await db.account.findMany({
      where: { id: { in: [...byAccount.keys()] }, contacts: { none: { state: "in_sequence" } } },
      select: { id: true, name: true, domain: true, industry: true, employees: true, country: true, fitScore: true, intentScore: true, tier: true },
    });
    // Snoozed or rejected from the daily list: hidden until the date the person chose.
    const held = await db.pipelineEvent.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, step: { in: ["daily.snooze", "daily.reject"] }, createdAt: { gte: new Date(now.getTime() - 120 * DAY) } }, select: { accountId: true, data: true } });
    const hidden = new Set(held.filter((h) => new Date(((h.data ?? {}) as { until?: string }).until ?? 0).getTime() > now.getTime()).map((h) => h.accountId));
    for (const a of accounts) {
      if (hidden.has(a.id)) continue;
      const ev = byAccount.get(a.id)!;
      const newest = ev[0].createdAt;
      const novelty = now.getTime() - newest.getTime() <= DAY ? 10 : 0;
      const intent = Math.round(a.intentScore);
      const score = Math.round(0.45 * (a.fitScore ?? 50) + 0.35 * intent + 0.2 * recency(ev[0].publishedAt, now) + novelty);
      items.push({
        kind: "account", id: a.id, name: a.name, domain: a.domain, industry: a.industry, employees: a.employees, country: a.country, fit: a.fitScore, intent, score,
        signals: ev.slice(0, 3).map((e) => ({ text: e.claim, quote: e.quote, url: e.sourceUrl, publisher: e.publisher ?? host(e.sourceUrl), at: (e.eventDate ?? e.publishedAt).toISOString(), kind: e.engine === "careers" ? "job post" : questionLabel(e.key) })),
        changed: changes.get(a.id) ?? ev.slice(0, 3).map((e) => `New: ${e.claim}`),
        estCostUsd: Math.min(cost, CONFIG.budgetsUsd[a.tier ?? "T3"]),
        why: [`Held account · ${ev.length} new signal${ev.length === 1 ? "" : "s"} this week`, a.fitScore != null ? `fit ${a.fitScore}` : null, novelty ? "new since yesterday" : null].filter(Boolean).join(" · "),
      });
    }
  }

  items.sort((a, b) => b.score - a.score);
  return items.slice(0, settings.maxNew);
}

export async function saveDailyList(sellerId: string, date: string, items: RecItem[], summary: Record<string, unknown>) {
  const data = { items: items as unknown as Prisma.InputJsonValue, summary: summary as Prisma.InputJsonValue };
  await db.dailyRecommendation.upsert({ where: { sellerId_date: { sellerId, date } }, create: { sellerId, date, ...data }, update: data });
}

/** Mark one item as acted on in today's list (it stays visible, greyed, with what was done). */
export async function markDecided(sellerId: string, id: string, decided: string, now = new Date()) {
  const row = await db.dailyRecommendation.findUnique({ where: { sellerId_date: { sellerId, date: istDate(now) } } });
  if (!row) return;
  const items = (row.items as unknown as RecItem[]).map((i) => (i.id === id ? { ...i, decided } : i));
  await db.dailyRecommendation.update({ where: { id: row.id }, data: { items: items as unknown as Prisma.InputJsonValue } });
}

/**
 * Estimated cost of one day's run for a client, before it runs: news searches (one per trigger
 * and industry, plus hiring) with an AI read each, plus re-checks (one search and read each, often
 * served from the cache). Careers job lists are free.
 */
export function estimateDailyCost(p: { triggers: unknown[]; icp: { industries: unknown[] } }, s: Required<DailySettings>): { usd: number; searches: number; lines: string[] } {
  const search = CONFIG.costsUsd.search.exa ?? 0.01;
  const ai = CONFIG.costsUsd.llmCheap;
  const newsSearches = s.news ? p.triggers.length + p.icp.industries.length + 1 : 0;
  // Size and country checks for new companies the scan finds: about a third of the searches.
  const firmo = s.news ? Math.ceil(newsSearches / 3) : 0;
  const recheck = s.recheck ? s.recheckPerDay : 0;
  const searches = newsSearches + firmo + recheck;
  const usd = Math.round(((newsSearches + firmo) * (search + ai) + recheck * (search + ai * 2)) * 100) / 100;
  const lines = [
    s.news ? `News scan: ${newsSearches} searches + about ${firmo} size checks` : null,
    s.jobs ? `Careers job lists: up to ${s.jobAccountsPerDay} sites (free)` : null,
    s.recheck ? `Re-checks: up to ${recheck} accounts (often free from the cache)` : null,
    s.lookalikes ? "Lookalikes: 1 reference company (costs more; investigations run after)" : null,
  ].filter((x): x is string => Boolean(x));
  return { usd: Math.min(usd, s.maxUsd), searches, lines };
}
