// Market scan: finds companies NOT yet in the database that just had a buying event.
// It searches the news for the seller's triggers and industries, keeps only companies
// backed by an exact quote, checks size and country against the targeting rule, and
// scores their intent with the same engine used for existing accounts.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { matchIndustry } from "@/lib/seller/fit";
import { mustHaveGate, quoteGate } from "@/lib/pipeline/gates";
import { companyNameKey, normalizeCountry } from "@/lib/pipeline/normalize";
import { scoreIntent, type IntentFamily, type IntentSignal } from "@/lib/brain/intent";
import { logEvent, newContext, type RunContext } from "@/lib/pipeline/context";
import { ingestRows } from "@/lib/pipeline/ingest";
import { publish } from "@/lib/brain/bus";
import type { ResearchPage } from "@/lib/adapters/types";

const DAY = 86_400_000;
/** Companies checked for size and country per scan (each check is one search). */
const ENRICH_LIMIT = 25;
/** Default scan interval (days) when the client's Brain doesn't set one: about twice a week. */
export const DEFAULT_SCAN_DAYS = 3;
/** How far back evidence is considered. Age lowers confidence through the intent score; it doesn't disqualify. */
export const LOOKBACK_DAYS = 365;
/** Reports of the same kind of event about one company within this many days are one event. */
export const SAME_EVENT_DAYS = 21;
/** A company is suggested only with at least this many independent events. */
export const MIN_INDEPENDENT_EVENTS = 2;
export const NO_PROSPECTS_MESSAGE = "No new prospects with qualifying signals found in the latest scan.";

/** Group a company's reports into independent events: same trigger within SAME_EVENT_DAYS = one event (earliest report dates it). */
export function groupEvents<T extends { triggerKey: string; publishedAt: Date }>(reports: T[]): T[][] {
  const groups: T[][] = [];
  for (const r of [...reports].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) {
    const g = groups.find((x) => x[0].triggerKey === r.triggerKey && Math.abs(r.publishedAt.getTime() - x[0].publishedAt.getTime()) <= SAME_EVENT_DAYS * DAY);
    if (g) g.push(r);
    else groups.push([r]);
  }
  return groups;
}

export const bucketOf = (industry: string | null | undefined) => matchIndustry(industry, seller())?.key ?? "other";

export function bucketLabel(key: string) {
  return seller().icp.industries.find((i) => i.key === key)?.label ?? "Other industries";
}

/** Event → intent family (from the seller pack), so different kinds of events converge rather than pile up. */
function familyOf(triggerKey: string): IntentFamily {
  if (triggerKey === HIRING_KEY) return "hiring";
  return seller().triggers.find((t) => t.key === triggerKey)?.family ?? "trigger";
}

/** Hiring for the roles that own the seller's problem is a buying signal of its own. */
export const HIRING_KEY = "hiring";

/** The searches one scan runs: one per seller trigger, one per industry. */
export function marketQueries() {
  const p = seller();
  const country = targetCountries();
  const triggers = p.triggers.map((t) => ({ key: `market:${t.key}`, query: `${country} company (${t.keywords.slice(0, 5).map((k) => `"${k}"`).join(" OR ")})`.trim() }));
  const events = p.triggers.map((t) => `"${t.keywords[0]}"`).join(" OR ");
  const industries = p.icp.industries.map((i) => ({ key: `market:ind:${i.key}`, query: `${country} ${i.match.slice(0, 3).map((k) => `"${k}"`).join(" OR ")} (${events})`.trim() }));
  // Job posts: the pack's "who owns this" search terms, phrased as hiring.
  const owner = p.researchQuestions.find((q) => q.key === "owner_function")?.search?.terms.replace(/^careers\s*/i, "");
  const hiring = owner ? [{ key: `market:${HIRING_KEY}`, query: `${country} (hiring OR "job opening" OR "we are hiring") ${owner}`.trim() }] : [];
  return [...triggers, ...industries, ...hiring];
}

/** The seller's required countries as words for a search, e.g. "India" or "(Germany OR France)". */
export function targetCountries(): string {
  const codes = seller().icp.mustHave?.countries ?? [];
  if (!codes.length) return "";
  let names: string[];
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    names = codes.map((c) => dn.of(c.toUpperCase()) ?? c);
  } catch {
    names = codes;
  }
  return names.length === 1 ? names[0] : `(${names.map((n) => `"${n}"`).join(" OR ")})`;
}

export interface ScanResult {
  searches: number;
  events: number;
  suggestions: number;
  excluded: number;
}

export async function scanMarket(ctx: RunContext = newContext()): Promise<ScanResult> {
  await ensureSellerPacks();
  const p = seller();
  const mode = ctx.adapters.research.live ? "live" : "mock";
  const country = targetCountries();
  let events = 0;
  const queries = marketQueries();
  for (const q of queries) {
    let pages: ResearchPage[] = [];
    try {
      pages = await ctx.adapters.research.search("", country, q.key, "main", { query: q.query });
    } catch (e) {
      await logEvent(ctx, { stage: 0, step: "discover.search", outcome: "error", reason: e instanceof Error ? e.message.slice(0, 200) : "search failed", data: { query: q.query } });
      continue;
    }
    if (!pages.length) continue;
    const found = await ctx.adapters.llm.extractMarketEvents(pages).catch(() => []);
    for (const f of found) {
      const page = pages[f.page];
      // The company must be named on the page and the quote must be its exact words.
      if (!page || !quoteGate(f.quote, page, mode).pass) continue;
      if (!`${page.title} ${page.text}`.toLowerCase().includes(f.company.toLowerCase().split(/\s+/)[0])) continue;
      const nameKey = companyNameKey(f.company);
      if (!nameKey) continue;
      const triggerKey = p.triggers.some((t) => t.key === f.triggerKey) || f.triggerKey === HIRING_KEY ? f.triggerKey : q.key === `market:${HIRING_KEY}` ? HIRING_KEY : "other";
      const data = { company: f.company, industry: f.industry, bucket: bucketOf(f.industry), triggerKey, claim: f.claim.slice(0, 300), quote: f.quote.slice(0, 400), publishedAt: page.publishedAt };
      await db.marketEvent.upsert({ where: { sellerId_sourceUrl_nameKey: { sellerId: p.id, sourceUrl: page.url, nameKey } }, create: { sellerId: p.id, nameKey, sourceUrl: page.url, ...data }, update: data });
      events++;
    }
  }
  const out = await buildSuggestions(ctx);
  await logEvent(ctx, { stage: 0, step: "discover.scan", outcome: "info", reason: out.suggestions ? `${events} market reports; ${out.suggestions} prospects with two or more independent signals, ${out.excluded} outside the targeting rule` : `${NO_PROSPECTS_MESSAGE} (${events} market reports read)`, data: { searches: queries.length, sellerId: p.id } });
  await publish(ctx, { type: "market.scanned", module: "discover", payload: { searches: queries.length, events, ...out } });
  return { searches: queries.length, events, ...out };
}

/** Groups recent market events by company, skips companies already held, checks the rule, scores intent. */
async function buildSuggestions(ctx: RunContext): Promise<{ suggestions: number; excluded: number }> {
  const p = seller();
  const since = new Date(ctx.now.getTime() - LOOKBACK_DAYS * DAY);
  const rows = await db.marketEvent.findMany({ where: { sellerId: p.id, publishedAt: { gte: since } }, orderBy: { publishedAt: "desc" } });
  const held = await db.account.findMany({ where: { nameKey: { in: [...new Set(rows.map((r) => r.nameKey))] } }, select: { nameKey: true } });
  const heldKeys = new Set(held.map((a) => a.nameKey));
  const existing = new Map((await db.prospectSuggestion.findMany({ where: { sellerId: p.id } })).map((s) => [s.nameKey, s]));

  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) if (!heldKeys.has(r.nameKey)) byCompany.set(r.nameKey, [...(byCompany.get(r.nameKey) ?? []), r]);

  let suggestions = 0;
  let excluded = 0;
  let enriched = 0;
  for (const [nameKey, evs] of byCompany) {
    const prev = existing.get(nameKey);
    if (prev?.status === "added") continue;
    // Independent events: many reports of one announcement count once.
    const groups = groupEvents(evs);
    // An ignored company returns only on genuinely new evidence: an event first seen after the decision.
    const fresh = prev?.status === "dismissed" ? groups.filter((g) => g.every((r) => r.createdAt > (prev.decidedAt ?? prev.updatedAt))) : groups;
    if (prev?.status === "dismissed" && !fresh.length) continue;
    // Size and country: reuse what we already know; otherwise one firmographics search.
    let firmo: { industry: string | null; employees: number | null; country: string | null } | null = prev && prev.country && prev.employees != null ? { industry: prev.industry, employees: prev.employees, country: prev.country } : null;
    if (!firmo && enriched < ENRICH_LIMIT) {
      enriched++;
      try {
        const pages = await ctx.adapters.research.search("", evs[0].company, "firmographics", "main");
        const f = await ctx.adapters.llm.extractFirmographics(pages, evs[0].company);
        if (f) firmo = { industry: f.industry, employees: f.employees, country: normalizeCountry(f.country) };
      } catch {
        // Unknown size/country stays unknown; the gate says so.
      }
    }
    const industry = evs.find((e) => e.industry)?.industry ?? firmo?.industry ?? null;
    const gate = mustHaveGate({ country: firmo?.country ?? null, employees: firmo?.employees ?? null });
    // One signal per independent event, dated by its first report; every report stays as evidence.
    const signals: IntentSignal[] = groups.map((g) => ({
      family: familyOf(g[0].triggerKey),
      label: g[0].claim,
      strength: 1,
      at: g[0].publishedAt,
      refs: g.map((e) => e.id),
      trigger: g[0].triggerKey,
    }));
    const reading = scoreIntent(signals);
    const sources = groups.slice(0, 6).map((g) => ({ url: g[0].sourceUrl, quote: g[0].quote, at: g[0].publishedAt.toISOString(), trigger: g[0].triggerKey, reports: g.length, newSinceIgnored: prev?.status === "dismissed" ? fresh.includes(g) : undefined }));
    const enough = groups.length >= MIN_INDEPENDENT_EVENTS;
    // Hard targeting gate first; then at least two independent events. One signal alone never qualifies.
    const status = gate.unknown ? "needs_check" : !gate.pass ? "excluded" : enough ? "new" : "watching";
    if (prev?.status === "dismissed" && status !== "new") continue;
    const resurfaced = prev?.status === "dismissed" && status === "new";
    const revised = prev?.status === "new" && status === "new" && (prev.score !== reading.score || (prev.sources as unknown[]).length !== sources.length);
    const data = {
      name: evs[0].company,
      industry,
      bucket: bucketOf(industry),
      country: firmo?.country ?? null,
      employees: firmo?.employees ?? null,
      score: reading.score,
      level: reading.level,
      whyNow: reading.whyNow ?? evs[0].claim,
      families: reading.families,
      sources: sources as unknown as Prisma.InputJsonValue,
      status,
      reason: !gate.pass ? gate.reason : enough ? null : `Only ${groups.length} independent signal; at least ${MIN_INDEPENDENT_EVENTS} are needed`,
      ...(resurfaced ? { resurfacedAt: ctx.now } : {}),
      ...(revised ? { version: { increment: 1 } } : {}),
    };
    await db.prospectSuggestion.upsert({ where: { sellerId_nameKey: { sellerId: p.id, nameKey } }, create: { sellerId: p.id, nameKey, ...data, version: 1 }, update: data });
    if (status === "excluded") excluded++;
    else if (status === "new") suggestions++;
  }
  return { suggestions, excluded };
}

/** From the tick, on the client's schedule (Account Brain, default every 3 days); never twice inside it. */
export async function maybeScanMarket(ctx: RunContext) {
  await ensureSellerPacks();
  const every = seller().discovery?.everyDays ?? DEFAULT_SCAN_DAYS;
  const last = await db.pipelineEvent.findFirst({ where: { step: "discover.scan", data: { path: ["sellerId"], equals: seller().id } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && ctx.now.getTime() - last.createdAt.getTime() < every * DAY - 60 * 60_000) return false;
  await scanMarket(ctx);
  return true;
}

/** Adds a suggestion as a company; the import queues it for the normal research run. */
export async function addSuggestion(id: string) {
  const s = await db.prospectSuggestion.findUniqueOrThrow({ where: { id } });
  if (s.status === "added" && s.accountId) return s.accountId;
  const res = await ingestRows(
    [{ "Company Name": s.name, ...(s.domain ? { "Company Website": s.domain } : {}), ...(s.industry ? { Industry: s.industry } : {}), ...(s.employees != null ? { "Employee Size": String(s.employees) } : {}), ...(s.country ? { Country: s.country } : {}) }],
    { source: s.origin === "lookalike" ? "lookalike" : s.origin === "website_visitor" ? "website-visitor" : "discover", filename: `${s.origin}-${s.name}` },
  );
  const accountId = res.accountIds[0] ?? null;
  await db.prospectSuggestion.update({ where: { id }, data: { status: "added", accountId, decidedAt: new Date() } });
  // Earlier website visits by this company now count for it.
  if (accountId) await db.webVisit.updateMany({ where: { accountId: null, OR: [...(s.domain ? [{ companyDomain: s.domain }] : []), { companyName: s.name }] }, data: { accountId } });
  return accountId;
}

export async function dismissSuggestion(id: string) {
  await db.prospectSuggestion.update({ where: { id }, data: { status: "dismissed", decidedAt: new Date(), resurfacedAt: null } });
}
