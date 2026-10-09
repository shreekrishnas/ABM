// Industry radar: which industries are heating up, and whether we hold enough companies
// there. Market events in the last 30 days are compared with the 60 days before; our own
// accounts' triggers and hot readings are added on top. A rising industry where we hold
// few companies is flagged — the miss we had with pharma.

import { db } from "@/lib/db";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { isTriggerKey } from "@/lib/research/keys";
import { bucketLabel, bucketOf } from "./scan";

const DAY = 86_400_000;

export type Momentum = "rising" | "steady" | "cooling" | "quiet";

export interface IndustryTrend {
  key: string;
  label: string;
  /** Distinct companies with a market event in the last 30 days. */
  recent: number;
  /** Same, per 30 days, over the 60 days before. */
  prior: number;
  momentum: Momentum;
  /** Trigger evidence found on our own accounts in the last 30 days. */
  internalTriggers: number;
  hotAccounts: number;
  held: number;
  /** How the seller pack ranks the industry (primary / secondary / not listed). */
  packTier: string | null;
  underCovered: boolean;
  heat: number;
  topTriggers: { key: string; label: string; count: number }[];
  evidence: { company: string; claim: string; url: string; at: Date }[];
  narrative: string;
}

export function momentumOf(recent: number, prior: number): Momentum {
  if (recent === 0 && prior === 0) return "quiet";
  if (recent >= 2 && recent >= prior * 1.5) return "rising";
  if (recent < prior * 0.6) return "cooling";
  return "steady";
}

export async function industryTrends(now = new Date()): Promise<IndustryTrend[]> {
  await ensureSellerPacks();
  const p = seller();
  const d30 = new Date(now.getTime() - 30 * DAY);
  const d90 = new Date(now.getTime() - 90 * DAY);
  const [events, accounts, evidence] = await Promise.all([
    db.marketEvent.findMany({ where: { sellerId: p.id, publishedAt: { gte: d90 } }, orderBy: { publishedAt: "desc" } }),
    db.account.findMany({ where: { mergedIntoId: null }, select: { id: true, industry: true, intentReading: true, pipelineStatus: true, disqualifyReason: true } }),
    db.evidence.findMany({ where: { createdAt: { gte: d30 }, status: { in: ["verified", "probable"] } }, select: { accountId: true, key: true } }),
  ]);
  const bucketByAccount = new Map(accounts.map((a) => [a.id, bucketOf(a.industry)]));
  const triggerLabel = (k: string) => p.triggers.find((t) => t.key === k)?.label ?? "Other buying events";

  const keys = [...new Set([...p.icp.industries.map((i) => i.key), ...events.map((e) => e.bucket)])];
  const trends = keys.map((key): IndustryTrend => {
    const evs = events.filter((e) => e.bucket === key);
    const recentEvs = evs.filter((e) => e.publishedAt >= d30);
    const recent = new Set(recentEvs.map((e) => e.nameKey)).size;
    const prior = new Set(evs.filter((e) => e.publishedAt < d30).map((e) => e.nameKey)).size / 2;
    const inBucket = accounts.filter((a) => bucketByAccount.get(a.id) === key);
    const held = inBucket.filter((a) => !a.disqualifyReason).length;
    const hotAccounts = inBucket.filter((a) => (a.intentReading as { level?: string } | null)?.level === "hot").length;
    const internalTriggers = evidence.filter((e) => isTriggerKey(e.key) && bucketByAccount.get(e.accountId) === key).length;
    const momentum = momentumOf(recent, prior);
    const counts = new Map<string, number>();
    for (const e of recentEvs) counts.set(e.triggerKey, (counts.get(e.triggerKey) ?? 0) + 1);
    const topTriggers = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, count]) => ({ key: k, label: triggerLabel(k), count }));
    const packTier = p.icp.industries.find((i) => i.key === key)?.tier ?? null;
    const underCovered = momentum === "rising" && held < 3;
    const heat = recent * 3 + internalTriggers + hotAccounts * 2 + (momentum === "rising" ? 5 : 0);
    return {
      key, label: bucketLabel(key), recent, prior, momentum, internalTriggers, hotAccounts, held, packTier, underCovered, heat, topTriggers,
      evidence: (recentEvs.length ? recentEvs : evs).slice(0, 4).map((e) => ({ company: e.company, claim: e.claim, url: e.sourceUrl, at: e.publishedAt })),
      narrative: narrate({ label: bucketLabel(key), recent, prior, momentum, held, hotAccounts, internalTriggers, packTier, underCovered, topTriggers }),
    };
  });
  return trends.sort((a, b) => b.heat - a.heat);
}

function narrate(t: Pick<IndustryTrend, "label" | "recent" | "prior" | "momentum" | "held" | "hotAccounts" | "internalTriggers" | "packTier" | "underCovered" | "topTriggers">): string {
  if (t.momentum === "quiet" && !t.internalTriggers && !t.hotAccounts) return "No buying events seen in the last 90 days.";
  const parts: string[] = [];
  const per = t.prior ? `, up from about ${t.prior.toFixed(t.prior % 1 ? 1 : 0)} a month before` : t.momentum === "rising" ? ", from almost none before" : "";
  if (t.momentum === "rising") parts.push(`${t.recent} companies had buying events in the last 30 days${per}.`);
  else if (t.momentum === "cooling") parts.push(`Cooling: ${t.recent} companies in the last 30 days against about ${t.prior.toFixed(t.prior % 1 ? 1 : 0)} a month before.`);
  else if (t.recent) parts.push(`${t.recent} companies had buying events in the last 30 days, about the usual pace.`);
  if (t.topTriggers.length) parts.push(`Mostly: ${t.topTriggers.map((x) => x.label.toLowerCase()).join("; ")}.`);
  if (t.internalTriggers || t.hotAccounts) parts.push(`In your own accounts: ${t.internalTriggers} new triggers${t.hotAccounts ? `, ${t.hotAccounts} hot` : ""}.`);
  if (t.underCovered) parts.push(`${t.held === 0 ? "You hold no companies here" : `You hold only ${t.held} ${t.held === 1 ? "company" : "companies"} here`}${t.packTier === "secondary" ? ", and your seller pack ranks it secondary" : !t.packTier ? ", and it isn't in your seller pack" : ""} — add companies before the window closes.`);
  return parts.join(" ");
}
