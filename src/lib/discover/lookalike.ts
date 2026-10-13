// Lookalikes: enter one company's website (a customer, a great prospect) and get companies
// like it. Apollo's company database first (same industry keywords, size and countries),
// then the web ("competitors of…", "companies like…"), every name backed by an exact quote.
// Results are suggestions: nothing is researched until a person approves them.

import { seller } from "@/lib/seller";
import { scoreFit } from "@/lib/pipeline/scoring";
import { quoteGate } from "@/lib/pipeline/gates";
import { companyNameKey, normalizeDomain } from "@/lib/pipeline/normalize";
import { apolloOrgEnrich, apolloOrgSearch } from "@/lib/adapters/live/apollo";
import { logEvent, newContext, type RunContext } from "@/lib/pipeline/context";
import type { ResearchPage } from "@/lib/adapters/types";
import { targetCountries } from "./scan";
import { firmographicsFor, heldKeys, saveSuggestion, type Candidate } from "./qualify";

const LIMIT = 25;
const apolloKey = () => (process.env.ADAPTER_MODE === "mock" ? undefined : process.env.APOLLO_API_KEY?.trim() || undefined);

/** "https://www.acme.co.in/about" → acme.co.in; a plain name stays a name. */
function parseSeed(input: string): { name: string; domain: string | null } {
  const t = input.trim();
  const looksLikeDomain = /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t);
  const domain = looksLikeDomain ? normalizeDomain(t) : null;
  const name = domain ? domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : t;
  return { name, domain };
}

export interface LookalikeResult {
  seed: string;
  found: number;
  suggested: number;
  excluded: number;
}

export async function findLookalikes(input: string, ctx: RunContext = newContext()): Promise<LookalikeResult> {
  const p = seller();
  const mode = ctx.adapters.research.live ? "live" : "mock";
  const parsed = parseSeed(input);
  const key = apolloKey();
  let seedName = parsed.name;
  let keywords: string[] = [];
  if (key && parsed.domain) {
    const o = await apolloOrgEnrich(key, parsed.domain).catch(() => null);
    if (o) {
      seedName = o.name;
      keywords = o.keywords;
    }
  }
  const seedFirmo = await firmographicsFor(ctx, { name: seedName, domain: parsed.domain });
  const country = targetCountries();

  const held = await heldKeys();
  const seen = new Set<string>([companyNameKey(seedName)]);
  const found: (Candidate & { reason: string; source?: { url: string; quote: string; at: string } })[] = [];
  const keep = (c: Candidate & { reason: string; source?: { url: string; quote: string; at: string } }) => {
    const k = companyNameKey(c.name);
    const d = normalizeDomain(c.domain);
    if (!k || seen.has(k) || held.names.has(k) || (d && (held.domains.has(d) || d === parsed.domain))) return;
    seen.add(k);
    found.push(c);
  };

  // 1. Apollo's company database: same industry keywords, the seller's size floor and countries.
  if (key && (seedFirmo.industry || keywords.length)) {
    try {
      const orgs = await apolloOrgSearch(key, { keywords: [seedFirmo.industry, ...keywords].filter(Boolean) as string[], minEmployees: p.icp.mustHave?.minEmployees, locations: country ? [country.replace(/[()"]/g, "")] : undefined, perPage: 40 });
      for (const o of orgs) keep({ name: o.name, domain: o.domain, industry: o.industry, employees: o.employees, country: o.country, reason: `Same profile in Apollo (${o.industry ?? seedFirmo.industry ?? "same keywords"})` });
    } catch (e) {
      await logEvent(ctx, { stage: 0, step: "lookalike.apollo", outcome: "error", reason: e instanceof Error ? e.message.slice(0, 200) : "Apollo search failed" });
    }
  }

  // 2. The web: competitors and peers named on pages, each backed by an exact quote.
  const queries = [
    { company: seedName, query: `"${seedName}" competitors OR alternatives OR "companies like"` },
    ...(seedFirmo.industry ? [{ company: "", query: `top ${seedFirmo.industry} companies ${country}`.trim() }] : []),
  ];
  for (const q of queries) {
    if (found.length >= LIMIT * 2) break;
    let pages: ResearchPage[] = [];
    try {
      pages = await ctx.adapters.research.search(parsed.domain ?? "", q.company, "lookalike", "main", { query: q.query });
    } catch {
      continue;
    }
    const items = await ctx.adapters.llm.extractSimilarCompanies(pages, { name: seedName, industry: seedFirmo.industry }).catch(() => []);
    for (const it of items) {
      const page = pages[it.page];
      if (!page || !quoteGate(it.quote, page, mode).pass) continue;
      keep({ name: it.name, domain: it.domain, reason: it.reason, source: { url: page.url, quote: it.quote, at: page.publishedAt.toISOString() } });
    }
  }

  let suggested = 0;
  let excluded = 0;
  for (const c of found.slice(0, LIMIT)) {
    const firmo = await firmographicsFor(ctx, c);
    const fit = scoreFit({ industry: firmo.industry ?? seedFirmo.industry, employees: firmo.employees, country: firmo.country }).fit ?? 50;
    const status = await saveSuggestion({
      origin: "lookalike", seed: seedName, candidate: c, firmo, score: fit, level: "cold",
      whyNow: `Similar to ${seedName}: ${c.reason}`,
      sources: c.source ? [{ ...c.source, trigger: "lookalike" }] : [],
    });
    if (status === "new") suggested++;
    if (status === "excluded") excluded++;
  }
  await logEvent(ctx, { stage: 0, step: "lookalike.search", outcome: "info", reason: `Companies like ${seedName}: ${found.length} found, ${suggested} suggested, ${excluded} outside the targeting rule` });
  return { seed: seedName, found: found.length, suggested, excluded };
}
