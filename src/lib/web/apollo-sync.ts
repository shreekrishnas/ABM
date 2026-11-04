// Daily: pull the companies Apollo's website-visitor tracking identified and feed them in as
// website visits. Known companies get an engagement signal (intent, priority, next action);
// unknown ones appear in Discover under "On your website, not in your database".

import { db } from "@/lib/db";
import { apolloVisitorCompanies } from "@/lib/adapters/live/apollo";
import { logEvent, type RunContext } from "@/lib/pipeline/context";
import { recordVisit } from "./visits";
import { suggestFromVisitors } from "@/lib/discover/visitors";

const DAY = 86_400_000;
const env = (name: string) => process.env[name]?.trim() || undefined;
/** Apollo keeps a company in the list after its visit; count it again only after this many days. */
const RECOUNT_DAYS = 7;

export function apolloVisitorsConfigured() {
  // The visitor list is found by name ("…visitor…") when it isn't configured.
  return Boolean(env("APOLLO_API_KEY"));
}

export async function syncApolloVisitors(ctx: RunContext, opts: { force?: boolean } = {}): Promise<{ companies: number; recorded: number; suggested: number; excluded: number } | null> {
  const key = env("APOLLO_API_KEY");
  const list = { id: env("APOLLO_VISITOR_LABEL_ID"), name: env("APOLLO_VISITOR_LIST") };
  if (!key || process.env.ADAPTER_MODE === "mock") return null;
  // Once a day is enough: Apollo updates visitors in batches.
  const last = await db.pipelineEvent.findFirst({ where: { step: "apollo.visitors", createdAt: { gte: new Date(ctx.now.getTime() - DAY + 3_600_000) } }, select: { id: true } });
  if (last && !opts.force) return null;
  let companies;
  try {
    companies = await apolloVisitorCompanies(key, list);
  } catch (e) {
    await logEvent(ctx, { stage: 0, step: "apollo.visitors", outcome: "error", reason: e instanceof Error ? e.message.slice(0, 300) : "Apollo request failed" });
    return { companies: 0, recorded: 0, suggested: 0, excluded: 0 };
  }
  let recorded = 0;
  let corrected = 0;
  const since = new Date(ctx.now.getTime() - RECOUNT_DAYS * DAY);
  const fields = new Set<string>();
  for (const c of companies) {
    if (c.dateField) fields.add(c.dateField);
    const where = { source: "apollo", OR: [...(c.domain ? [{ companyDomain: c.domain }] : []), { companyName: c.name }] };
    const last = await db.webVisit.findFirst({ where, orderBy: { occurredAt: "desc" }, select: { id: true, occurredAt: true } });
    // The visit is dated by Apollo's own activity date, never by when it was fetched.
    if (c.lastSeenAt && last) {
      const diff = c.lastSeenAt.getTime() - last.occurredAt.getTime();
      if (diff > DAY) {
        // Apollo saw newer activity: a new visit.
      } else {
        // Same visit; an earlier fetch may have dated it by the fetch time: use Apollo's date.
        if (Math.abs(diff) > DAY) {
          await db.webVisit.update({ where: { id: last.id }, data: { occurredAt: c.lastSeenAt } });
          corrected++;
        }
        continue;
      }
    } else if (last && (await db.webVisit.count({ where: { ...where, occurredAt: { gte: since } } }))) continue;
    await recordVisit({ url: "https://apollo.io/website-visitors", title: "Visited the website (seen by Apollo)", companyName: c.name, companyDomain: c.domain, source: "apollo", occurredAt: c.lastSeenAt ?? undefined }, ctx);
    recorded++;
  }
  // Visitors not in the database become suggestions (checked against the targeting rule) for approval.
  // Apollo dates visits by its own activity date, which can be months back.
  const s = await suggestFromVisitors(ctx, 180);
  await logEvent(ctx, { stage: 0, step: "apollo.visitors", outcome: "info", reason: `Apollo website visitors: ${companies.length} companies in the list, ${recorded} new visits recorded${corrected ? `, ${corrected} visit dates corrected to Apollo's date` : ""}, ${s.suggested} new companies suggested`, data: { companies: companies.length, recorded, corrected, dateFields: [...fields], undated: companies.filter((c) => !c.lastSeenAt).length } });
  return { companies: companies.length, recorded, ...s };
}
