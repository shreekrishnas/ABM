// Website visitors → suggestions. Companies that visited the site (from Apollo or another
// visitor tool) but aren't in the database are checked against the targeting rule and saved
// as suggestions; a person approves them before any research or outreach.

import { db } from "@/lib/db";
import { scoreIntent, type IntentSignal } from "@/lib/brain/intent";
import { companyNameKey } from "@/lib/pipeline/normalize";
import type { RunContext } from "@/lib/pipeline/context";
import { topicOf } from "@/lib/web/visits";
import { firmographicsFor, heldKeys, saveSuggestion } from "./qualify";

const DAY = 86_400_000;

export async function suggestFromVisitors(ctx: RunContext, days = 30): Promise<{ suggested: number; excluded: number }> {
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
  for (const visits of by.values()) {
    const v0 = visits[0];
    const topics = [...new Set(visits.map((v) => topicOf(v.url, v.title)).filter((t) => t.key !== "general").map((t) => t.label))];
    const signals: IntentSignal[] = visits.slice(0, 20).map((v) => ({ family: "engagement", label: v.title ?? v.path, strength: ["pricing", "demo"].includes(v.topic) ? 0.9 : 0.4, at: v.occurredAt, refs: [v.id] }));
    const reading = scoreIntent(signals);
    const firmo = await firmographicsFor(ctx, { name: v0.companyName!, domain: v0.companyDomain });
    const status = await saveSuggestion({
      origin: "website_visitor", candidate: { name: v0.companyName!, domain: v0.companyDomain }, firmo,
      score: reading.score, level: reading.level, families: ["engagement"],
      whyNow: `Visited your website ${visits.length === 1 ? "once" : `${visits.length} times`} in the last ${days} days${topics.length ? ` — ${topics.slice(0, 3).join(", ").toLowerCase()}` : ""}`,
    });
    if (status === "new") suggested++;
    if (status === "excluded") excluded++;
  }
  return { suggested, excluded };
}
