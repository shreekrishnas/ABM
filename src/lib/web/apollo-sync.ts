// Daily: pull the companies Apollo's website-visitor tracking identified and feed them in as
// website visits. Known companies get an engagement signal (intent, priority, next action);
// unknown ones appear in Discover under "On your website, not in your database".

import { db } from "@/lib/db";
import { apolloVisitorCompanies } from "@/lib/adapters/live/apollo";
import { logEvent, type RunContext } from "@/lib/pipeline/context";
import { recordVisit } from "./visits";

const DAY = 86_400_000;
const env = (name: string) => process.env[name]?.trim() || undefined;
/** Apollo keeps a company in the list after its visit; count it again only after this many days. */
const RECOUNT_DAYS = 7;

export function apolloVisitorsConfigured() {
  return Boolean(env("APOLLO_API_KEY") && (env("APOLLO_VISITOR_LIST") || env("APOLLO_VISITOR_LABEL_ID")));
}

export async function syncApolloVisitors(ctx: RunContext): Promise<{ companies: number; recorded: number } | null> {
  const key = env("APOLLO_API_KEY");
  const list = { id: env("APOLLO_VISITOR_LABEL_ID"), name: env("APOLLO_VISITOR_LIST") };
  if (!key || !(list.id || list.name) || process.env.ADAPTER_MODE === "mock") return null;
  // Once a day is enough: Apollo updates visitors in batches.
  const last = await db.pipelineEvent.findFirst({ where: { step: "apollo.visitors", createdAt: { gte: new Date(ctx.now.getTime() - DAY + 3_600_000) } }, select: { id: true } });
  if (last) return null;
  let companies;
  try {
    companies = await apolloVisitorCompanies(key, list);
  } catch (e) {
    await logEvent(ctx, { stage: 0, step: "apollo.visitors", outcome: "error", reason: e instanceof Error ? e.message.slice(0, 300) : "Apollo request failed" });
    return { companies: 0, recorded: 0 };
  }
  let recorded = 0;
  const since = new Date(ctx.now.getTime() - RECOUNT_DAYS * DAY);
  for (const c of companies) {
    const seen = await db.webVisit.count({ where: { source: "apollo", occurredAt: { gte: since }, OR: [...(c.domain ? [{ companyDomain: c.domain }] : []), { companyName: c.name }] } });
    if (seen) continue;
    await recordVisit({ url: "https://apollo.io/website-visitors", title: "Visited the website (seen by Apollo)", companyName: c.name, companyDomain: c.domain, source: "apollo" }, ctx);
    recorded++;
  }
  await logEvent(ctx, { stage: 0, step: "apollo.visitors", outcome: "info", reason: `Apollo website visitors: ${companies.length} companies in the list, ${recorded} new visits recorded` });
  return { companies: companies.length, recorded };
}
