// AI company discovery from a description: "Indian pharma makers with 5,000+ staff moving to SAP".
//
//   1. Draft: the AI turns the description into criteria (industries, countries, size range,
//      business models, must-haves, exclusions, technologies, funding, buying signals, search
//      queries). Code cleans them (ISO countries, sane ranges, capped lists) and a person edits and
//      confirms them before anything is searched.
//   2. Search: each query runs on Exa or Tavily; the AI lists the companies each page names that
//      fit, with an exact quote; code drops anything not on the page, already held, outside the
//      stated countries or size range, or outside the client's targeting rule.
//   3. Investigate: the best candidates go through the same investigation as lookalikes — rounds of
//      questions, quoted facts, a judged fit against the confirmed criteria — and wait for a person
//      to approve. Contacts are looked up only after approval.

import type { DiscoverySearch, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { ensureMonthlyBudget } from "@/lib/budget";
import { logEvent, newContext, type RunContext } from "@/lib/pipeline/context";
import { quoteGate } from "@/lib/pipeline/gates";
import { companyNameKey, normalizeCountry, normalizeDomain } from "@/lib/pipeline/normalize";
import type { LookalikeProfile, ResearchPage } from "@/lib/adapters/types";
import { costMeter, lookalikeCriteria, offeringOf } from "./lookalike";
import { firmographicsFor, heldKeys, saveSuggestion } from "./qualify";

export interface DiscoveryCriteria {
  /** One sentence restating what is wanted, shown on every card. */
  summary: string;
  industries: string[];
  /** ISO 3166 alpha-2. Empty = any. */
  countries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  businessModels: string[];
  /** Traits a candidate must show (checked by the investigation). */
  mustHave: string[];
  niceToHave: string[];
  /** Traits that rule a company out. */
  exclude: string[];
  technologies: string[];
  funding: { stages: string[]; minAmountUsd: number | null; withinMonths: number | null } | null;
  /** Buying events wanted (expansion, ERP migration, new plant…). */
  signals: string[];
  /** 3–6 web searches that would surface such companies. */
  queries: string[];
}

const list = (v: unknown, max: number, len = 120) => [...new Set((Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]/) : []).map((x) => String(x).trim()).filter((x) => x.length > 1).map((x) => x.slice(0, len)))].slice(0, max);
const intOrNull = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[,_\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** Search queries built from the criteria when the AI's are missing or too few. */
export function buildQueries(c: Omit<DiscoveryCriteria, "queries">): string[] {
  const where = c.countries.length ? ` ${c.countries.map((x) => COUNTRY_NAME[x] ?? x).join(" OR ")}` : "";
  const size = c.minEmployees ? ` ${c.minEmployees.toLocaleString("en-US")}+ employees` : "";
  const out: string[] = [];
  for (const ind of c.industries.slice(0, 3)) out.push(`leading ${ind} companies${where}${size}`.trim());
  for (const s of c.signals.slice(0, 2)) out.push(`${c.industries[0] ?? "companies"} ${s}${where}`.trim());
  for (const t of c.technologies.slice(0, 1)) out.push(`${c.industries[0] ?? "companies"} using ${t}${where}`.trim());
  if (c.funding?.stages.length) out.push(`${c.industries[0] ?? "startups"} raised ${c.funding.stages.join(" OR ")} funding${where}`.trim());
  if (!out.length && c.summary) out.push(c.summary);
  return [...new Set(out)].slice(0, 6);
}

const COUNTRY_NAME: Record<string, string> = { IN: "India", US: "United States", GB: "United Kingdom", AE: "UAE", SA: "Saudi Arabia", SG: "Singapore", AU: "Australia", DE: "Germany", FR: "France", ID: "Indonesia", MY: "Malaysia", PH: "Philippines", QA: "Qatar", OM: "Oman", KW: "Kuwait", BH: "Bahrain", JP: "Japan", CA: "Canada" };

/** Clean whatever the AI (or the edit form) produced into criteria code can rely on. */
export function cleanCriteria(raw: Partial<Record<keyof DiscoveryCriteria, unknown>>, brief: string): DiscoveryCriteria {
  let min = intOrNull(raw.minEmployees);
  let max = intOrNull(raw.maxEmployees);
  if (min && max && min > max) [min, max] = [max, min];
  const countries = list(raw.countries, 12, 60).map((c) => normalizeCountry(c)).filter((c): c is string => Boolean(c && /^[A-Z]{2}$/.test(c)));
  const f = (raw.funding ?? null) as { stages?: unknown; minAmountUsd?: unknown; withinMonths?: unknown } | null;
  const funding = f && (list(f.stages, 6).length || intOrNull(f.minAmountUsd) || intOrNull(f.withinMonths)) ? { stages: list(f.stages, 6, 40), minAmountUsd: intOrNull(f.minAmountUsd), withinMonths: intOrNull(f.withinMonths) } : null;
  const base = {
    summary: (typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : brief.trim()).slice(0, 300),
    industries: list(raw.industries, 8, 60), countries: [...new Set(countries)], minEmployees: min, maxEmployees: max,
    businessModels: list(raw.businessModels, 6), mustHave: list(raw.mustHave, 6, 160), niceToHave: list(raw.niceToHave, 6, 160), exclude: list(raw.exclude, 6, 160),
    technologies: list(raw.technologies, 8, 60), funding, signals: list(raw.signals, 6, 100),
  };
  const queries = list(raw.queries, 6, 200);
  return { ...base, queries: queries.length >= 3 ? queries : [...new Set([...queries, ...buildQueries(base)])].slice(0, 6) };
}

/** The confirmed criteria as the "reference profile" every candidate is investigated and judged against. */
export function criteriaProfile(c: DiscoveryCriteria): LookalikeProfile {
  const size = c.minEmployees || c.maxEmployees ? `${c.minEmployees ? `${c.minEmployees.toLocaleString("en-US")}+` : "up to"}${c.maxEmployees ? ` ${c.maxEmployees.toLocaleString("en-US")}` : ""} employees` : "any size";
  return {
    summary: c.summary,
    businessModel: c.businessModels.join("; ") || "as described",
    operations: [...c.mustHave, ...c.technologies.map((t) => `uses ${t}`)].join("; ") || "as described",
    industry: c.industries.join(", ") || null,
    customers: c.niceToHave.join("; ") || "unknown",
    scale: `${size}${c.countries.length ? ` in ${c.countries.map((x) => COUNTRY_NAME[x] ?? x).join(", ")}` : ""}`,
    offeringFit: [...c.signals, ...(c.funding ? [`raised ${c.funding.stages.join(" or ") || "funding"}${c.funding.withinMonths ? ` in the last ${c.funding.withinMonths} months` : ""}${c.funding.minAmountUsd ? ` of at least $${c.funding.minAmountUsd.toLocaleString("en-US")}` : ""}`] : [])].join("; ") || "as described",
  };
}

/** Must-haves the investigation checks (the client's focus plus this search's), and rule-outs. */
export function criteriaRules(c: DiscoveryCriteria) {
  const must = [...c.mustHave];
  if (c.technologies.length) must.push(`uses ${c.technologies.join(" or ")}`);
  if (c.funding) must.push(`raised ${c.funding.stages.join(" or ") || "a funding round"}${c.funding.withinMonths ? ` within the last ${c.funding.withinMonths} months` : ""}`);
  return { focus: must, avoid: c.exclude };
}

export const searchSeed = (id: string) => `search:${id}`;

/** Step 1: the AI drafts criteria from the description; nothing is searched until a person confirms. */
export async function draftDiscovery(brief: string, createdBy: string | null, ctx: RunContext = newContext()): Promise<DiscoverySearch> {
  const p = seller();
  const text = brief.trim().slice(0, 1000);
  await ensureMonthlyBudget(p.id, 0.01);
  const m = costMeter(p.id);
  m.llm();
  const raw = await ctx.adapters.llm.parseDiscoveryBrief(text, { offering: offeringOf(p), defaultCountries: p.icp.mustHave?.countries ?? p.icp.geos.primary }).catch(() => ({}));
  const criteria = cleanCriteria(raw, text);
  await m.flush("Company search: criteria");
  return db.discoverySearch.create({ data: { sellerId: p.id, brief: text, criteria: criteria as unknown as Prisma.InputJsonValue, status: "draft", createdBy } });
}

export interface DiscoveryRun { found: number; queued: number; excluded: number; skipped: { name: string; reason: string }[] }

/** Steps 2–3: search with the confirmed criteria, keep what fits, queue the best for investigation. */
export async function runDiscovery(id: string, ctx: RunContext = newContext()): Promise<DiscoveryRun> {
  const search = await db.discoverySearch.findUniqueOrThrow({ where: { id } });
  const c = search.criteria as unknown as DiscoveryCriteria;
  const p = seller();
  const crit = lookalikeCriteria(p);
  const mode = ctx.adapters.research.live ? "live" : "mock";
  await ensureMonthlyBudget(p.id, 0.05);
  const m = costMeter(p.id);
  await db.discoverySearch.update({ where: { id }, data: { status: "searching", error: null } });
  const held = await heldKeys();
  // Already suggested (any search, waiting or decided): never re-queued or moved to this search.
  const suggested = new Set((await db.prospectSuggestion.findMany({ where: { sellerId: p.id }, select: { nameKey: true } })).map((x) => x.nameKey));
  const seen = new Set<string>();
  const found: { name: string; domain: string | null; reason: string; source: { url: string; quote: string; at: string } }[] = [];
  const queries: { query: string; engine: string; pages: number; companies: number; error?: string }[] = [];
  const skipped: DiscoveryRun["skipped"] = [];
  try {
    for (const [i, q] of c.queries.entries()) {
      const engine = i % 2 === 0 ? "exa" : "tavily";
      let pages: ResearchPage[] = [];
      try {
        pages = await ctx.adapters.research.search("", "", "discover_brief", i % 2 === 0 ? "main" : "followup", { query: q, engine, onAttempt: m.onAttempt });
      } catch (e) {
        queries.push({ query: q, engine, pages: 0, companies: 0, error: e instanceof Error ? e.message.slice(0, 120) : "failed" });
        continue;
      }
      if (pages.length) m.llm();
      const items = pages.length ? await ctx.adapters.llm.extractCompaniesForBrief(pages, c).catch(() => []) : [];
      let n = 0;
      for (const it of items) {
        const page = pages[it.page];
        if (!page || !quoteGate(it.quote, page, mode).pass) continue;
        const k = companyNameKey(it.name);
        const d = normalizeDomain(it.domain);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        if (held.names.has(k) || (d && held.domains.has(d))) { skipped.push({ name: it.name, reason: "already in your companies" }); continue; }
        if (suggested.has(k)) { skipped.push({ name: it.name, reason: "already suggested" }); continue; }
        found.push({ name: it.name, domain: it.domain, reason: it.reason, source: { url: page.url, quote: it.quote, at: page.publishedAt.toISOString() } });
        n++;
      }
      queries.push({ query: q, engine, pages: pages.length, companies: n });
      if (found.length >= crit.candidates * 3) break;
    }

    // Hard criteria first (no contact provider): stated countries and size range, then the client's rule.
    let queued = 0;
    let excluded = 0;
    const profile = criteriaProfile(c);
    const rules = criteriaRules(c);
    for (const f of found) {
      if (queued >= crit.candidates) break;
      const firmo = await firmographicsFor(ctx, { name: f.name, domain: f.domain }, { apollo: false });
      if (c.countries.length && firmo.country && !c.countries.includes(firmo.country)) { skipped.push({ name: f.name, reason: `based in ${firmo.country}, not ${c.countries.join("/")}` }); continue; }
      if (firmo.employees != null && c.minEmployees && firmo.employees < c.minEmployees) { skipped.push({ name: f.name, reason: `${firmo.employees.toLocaleString()} employees, below ${c.minEmployees.toLocaleString()}` }); continue; }
      if (firmo.employees != null && c.maxEmployees && firmo.employees > c.maxEmployees) { skipped.push({ name: f.name, reason: `${firmo.employees.toLocaleString()} employees, above ${c.maxEmployees.toLocaleString()}` }); continue; }
      const status = await saveSuggestion({
        origin: "discovery", seed: searchSeed(id), candidate: { name: f.name, domain: f.domain }, firmo, score: 0, level: "cold",
        whyNow: `Matches your search: ${f.reason}`, sources: [{ ...f.source, trigger: "discovery" }],
        seedProfile: { industry: profile.industry, employees: c.minEmployees, country: c.countries[0] ?? null, profile, focus: rules.focus, avoid: rules.avoid },
      });
      if (status === "excluded") { excluded++; continue; }
      if (status === "new") {
        await db.prospectSuggestion.update({ where: { sellerId_nameKey: { sellerId: p.id, nameKey: companyNameKey(f.name) } }, data: { researchStatus: "queued", researchNote: null, requestedBy: search.createdBy } });
        queued++;
      }
    }
    await db.discoverySearch.update({ where: { id }, data: { status: "done", candidates: queued, queries: { runs: queries, skipped: skipped.slice(0, 40), found: found.length, excluded } as unknown as Prisma.InputJsonValue } });
    await m.flush(`Company search: ${c.summary.slice(0, 60)}`);
    await logEvent(ctx, { stage: 0, step: "discovery.search", outcome: "info", reason: `"${c.summary.slice(0, 80)}": ${found.length} found, ${queued} queued for investigation, ${excluded} outside the targeting rule, ${skipped.length} skipped` });
    return { found: found.length, queued, excluded, skipped };
  } catch (e) {
    await db.discoverySearch.update({ where: { id }, data: { status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Search failed", queries: { runs: queries } as unknown as Prisma.InputJsonValue } });
    await m.flush("Company search (failed)").catch(() => undefined);
    throw e;
  }
}
