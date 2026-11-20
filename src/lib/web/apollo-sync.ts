// Daily: pull the companies Apollo's website-visitor tracking identified and feed them in as
// website visits. Known companies get an engagement signal (intent, priority, next action);
// unknown ones appear in Discover under "On your website, not in your database".

import { db } from "@/lib/db";
import { apolloVisitDates, apolloVisitorCompanies } from "@/lib/adapters/live/apollo";
import { seller } from "@/lib/seller";
import { logEvent, type RunContext } from "@/lib/pipeline/context";
import { clientForSite, recordVisit } from "./visits";
import { suggestFromVisitors } from "@/lib/discover/visitors";

const DAY = 86_400_000;
const env = (name: string) => process.env[name]?.trim() || undefined;
/** Apollo keeps a company in the list after its visit; count it again only after this many days. */
const RECOUNT_DAYS = 7;
import { UNKNOWN_DATE_TITLE } from "./visits";
export { UNKNOWN_DATE_TITLE };

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
  let companies: Awaited<ReturnType<typeof apolloVisitorCompanies>>;
  try {
    companies = await apolloVisitorCompanies(key, list);
  } catch (e) {
    await logEvent(ctx, { stage: 0, step: "apollo.visitors", outcome: "error", reason: e instanceof Error ? e.message.slice(0, 300) : "Apollo request failed" });
    return { companies: 0, recorded: 0, suggested: 0, excluded: 0 };
  }
  // The real visit date per company (the list only says when a company was saved to it).
  const site = env("APOLLO_VISITOR_SITE") ?? (seller().website || null);
  // The client whose website Apollo tracks: visits count for that client's companies only.
  const siteClient = await clientForSite(site);
  let realDates = 0, otherSite = 0, dateError: string | null = null;
  try {
    const dates = await apolloVisitDates(key, companies.map((c) => c.domain ?? "").filter(Boolean), site);
    const kept: typeof companies = [];
    for (const c of companies) {
      const v = c.domain ? dates.get(c.domain) : undefined;
      if (v === "other_site") {
        otherSite++;
        continue; // visited another tracked site, not ours
      }
      if (v) {
        c.lastSeenAt = v.at;
        c.dateField = v.field;
        realDates++;
      }
      kept.push(c);
    }
    companies = kept;
  } catch (e) {
    // Visit dates are a refinement: without them, the list's own dates are used as before.
    dateError = e instanceof Error ? e.message.slice(0, 200) : "Apollo company search failed";
  }
  let recorded = 0;
  let corrected = 0;
  const since = new Date(ctx.now.getTime() - RECOUNT_DAYS * DAY);
  const fields = new Set<string>();
  let unknownDate = 0;
  for (const c of companies) {
    if (c.dateField) fields.add(c.dateField);
    // Apollo has no visit date to our site for this company: list it, but never date it by the day it was saved.
    const realDate = Boolean(c.dateField && /^(domain_aggregates|intent_signal)/.test(c.dateField));
    if (!dateError && !realDate) {
      const whereCo = { source: "apollo", OR: [...(c.domain ? [{ companyDomain: c.domain }] : []), { companyName: c.name }] };
      const had = await db.webVisit.findFirst({ where: whereCo, orderBy: { occurredAt: "desc" }, select: { id: true, title: true } });
      if (had) {
        if (had.title !== UNKNOWN_DATE_TITLE) await db.webVisit.update({ where: { id: had.id }, data: { title: UNKNOWN_DATE_TITLE } });
      } else {
        await recordVisit({ url: "https://apollo.io/website-visitors", title: UNKNOWN_DATE_TITLE, companyName: c.name, companyDomain: c.domain, source: "apollo", occurredAt: c.lastSeenAt ?? undefined, sellerId: siteClient }, ctx);
        recorded++;
      }
      unknownDate++;
      continue;
    }
    const where = { source: "apollo", OR: [...(c.domain ? [{ companyDomain: c.domain }] : []), { companyName: c.name }] };
    const last = await db.webVisit.findFirst({ where, orderBy: { occurredAt: "desc" }, select: { id: true, occurredAt: true, title: true } });
    // A visit shown earlier as "date unknown" now has its real date.
    if (last?.title === UNKNOWN_DATE_TITLE && c.lastSeenAt) {
      await db.webVisit.update({ where: { id: last.id }, data: { title: "Visited the website (seen by Apollo)", occurredAt: c.lastSeenAt } });
      corrected++;
      continue;
    }
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
    await recordVisit({ url: "https://apollo.io/website-visitors", title: "Visited the website (seen by Apollo)", companyName: c.name, companyDomain: c.domain, source: "apollo", occurredAt: c.lastSeenAt ?? undefined, sellerId: siteClient }, ctx);
    recorded++;
  }
  // Visitors not in the database become suggestions (checked against the targeting rule) for approval.
  // Apollo dates visits by its own activity date, which can be months back.
  const s = await suggestFromVisitors(ctx, 180);
  await logEvent(ctx, { stage: 0, step: "apollo.visitors", outcome: "info", reason: `Apollo website visitors: ${companies.length} companies in the list, ${recorded} new visits recorded${corrected ? `, ${corrected} visit dates corrected to Apollo's date` : ""}, ${s.suggested} with 2+ buying signals sent for approval, ${s.justVisitors} kept as visitors only · ${realDates} dated by their real visit to ${site ?? "the site"}${otherSite ? `, ${otherSite} visited only another site` : ""}${unknownDate ? `, ${unknownDate} with no visit date (shown as date unknown)` : ""}${dateError ? ` · visit dates unavailable: ${dateError}` : ""}`, data: { companies: companies.length, recorded, corrected, realDates, otherSite, unknownDate, site, dateError, dateFields: [...fields], undated: companies.filter((c) => !c.lastSeenAt).length } });
  return { companies: companies.length, recorded, ...s };
}
