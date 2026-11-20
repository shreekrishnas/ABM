// Website visitors → suggestions. A visit on its own is just a visit: it stays on the Website
// visitors page. Only a company showing at least two separate buying signals (repeat visits on
// different days, a pricing / demo / contact page, several topics, or a matching news or
// market event) is saved as a suggestion for a person to approve before any research.

import { db } from "@/lib/db";
import { scoreIntent, type IntentSignal } from "@/lib/brain/intent";
import { companyNameKey } from "@/lib/pipeline/normalize";
import type { RunContext } from "@/lib/pipeline/context";
import { topicOf } from "@/lib/web/visits";
import { firmographicsFor, heldKeys, saveSuggestion } from "./qualify";

const DAY = 86_400_000;

export const MIN_VISITOR_SIGNALS = 2;
const HIGH_INTENT = new Set(["pricing", "demo", "contact"]);

/** The separate buying signals a visiting company shows. Pure: the caller supplies visits and market hits. */
export function visitorSignals(visits: { occurredAt: Date; topic: string; url: string; title: string | null }[], marketEvents: { title: string }[] = []): string[] {
  const out: string[] = [];
  const days = new Set(visits.map((v) => v.occurredAt.toISOString().slice(0, 10)));
  if (days.size >= 2) out.push(`came back on ${days.size} different days`);
  const hot = [...new Set(visits.map((v) => v.topic).filter((t) => HIGH_INTENT.has(t)))];
  if (hot.length) out.push(`looked at ${hot.join(" and ")}`);
  const topics = new Set(visits.map((v) => topicOf(v.url, v.title)).filter((t) => t.key !== "general").map((t) => t.key));
  if (topics.size >= 2) out.push(`read about ${topics.size} different topics`);
  if (marketEvents.length) out.push(`in the news: ${marketEvents[0].title.slice(0, 80)}`);
  return out;
}

export async function suggestFromVisitors(ctx: RunContext, days = 30): Promise<{ suggested: number; excluded: number; justVisitors: number }> {
  const rows = await db.webVisit.findMany({ where: { accountId: null, companyName: { not: null }, occurredAt: { gte: new Date(ctx.now.getTime() - days * DAY) } }, orderBy: { occurredAt: "desc" }, take: 1000 });
  const held = await heldKeys();
  const by = new Map<string, typeof rows>();
  for (const v of rows) {
    const k = companyNameKey(v.companyName!);
    if (!k || held.names.has(k) || (v.companyDomain && held.domains.has(v.companyDomain))) continue;
    by.set(k, [...(by.get(k) ?? []), v]);
  }
  let suggested = 0;
  let excluded = 0;
  let justVisitors = 0;
  for (const [key, visits] of by) {
    const v0 = visits[0];
    // Only companies with at least two separate buying signals go to approval.
    const market = await db.marketEvent.findMany({ where: { nameKey: key, publishedAt: { gte: new Date(ctx.now.getTime() - 90 * DAY) } }, orderBy: { publishedAt: "desc" }, take: 1, select: { claim: true } }).then((r) => r.map((x) => ({ title: x.claim }))).catch(() => []);
    const why = visitorSignals(visits, market);
    if (why.length < MIN_VISITOR_SIGNALS) { justVisitors++; continue; }
    const topics = [...new Set(visits.map((v) => topicOf(v.url, v.title)).filter((t) => t.key !== "general").map((t) => t.label))];
    const signals: IntentSignal[] = visits.slice(0, 20).map((v) => ({ family: "engagement", label: v.title ?? v.path, strength: ["pricing", "demo"].includes(v.topic) ? 0.9 : 0.4, at: v.occurredAt, refs: [v.id] }));
    const reading = scoreIntent(signals);
    const firmo = await firmographicsFor(ctx, { name: v0.companyName!, domain: v0.companyDomain });
    const status = await saveSuggestion({
      origin: "website_visitor", skipTargeting: true, candidate: { name: v0.companyName!, domain: v0.companyDomain }, firmo,
      score: reading.score, level: reading.level, families: ["engagement"],
      whyNow: `Visited your website and ${why.join("; ")}${topics.length ? ` (${topics.slice(0, 3).join(", ").toLowerCase()})` : ""}`,
    });
    if (status === "new") suggested++;
    if (status === "excluded") excluded++;
  }
  return { suggested, excluded, justVisitors };
}
