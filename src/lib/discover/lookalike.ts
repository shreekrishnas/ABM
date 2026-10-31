// Lookalikes: start from a company that buys from the client (a customer, a qualified account)
// and find companies genuinely like it — same business model, operations, industry and scale,
// and a real reason to need the client's offering.
//
//   1. Profile the reference company from its own pages (Exa, then Tavily).
//   2. Discover candidates: Exa "find similar" on its website, an Exa search on its business
//      model and operations, Tavily searches for peers and competitors. Every name needs a quote.
//   3. Investigate each candidate in the background. The AI asks its own follow-up questions
//      round by round (including ones that could disprove the match), facts must be quoted,
//      and a fact is verified when two independent sites (or the company's own) state it.
//   4. Judge: fit per dimension and buying readiness from the facts; code caps what weak
//      evidence can claim. The result waits for a person: approve, reject, or research more.
//
// Apollo is never called here. Decision-makers and contact details are looked up only after
// a person approves the company (see approval.ts).

import type { Prisma, ProspectSuggestion } from "@prisma/client";
import { db } from "@/lib/db";
import { seller, withSeller, type SellerProfile } from "@/lib/seller";
import { quoteGate, mustHaveGate } from "@/lib/pipeline/gates";
import { companyNameKey, normalizeDomain } from "@/lib/pipeline/normalize";
import { logEvent, newContext, recordAccountCost, type RunContext } from "@/lib/pipeline/context";
import { CONFIG } from "@/lib/config";
import { MonthlyBudgetExceeded, ensureMonthlyBudget } from "@/lib/budget";
import type { LookalikeDimension, LookalikeKnownFact, LookalikeProfile, LookalikeQuestion, ResearchPage } from "@/lib/adapters/types";
import { targetCountries } from "./scan";
import { recordError } from "@/lib/admin/errors";
import { INVESTIGATED_ORIGINS, firmographicsFor, heldKeys, saveSuggestion, type Candidate } from "./qualify";

/** How much each dimension counts toward the fit score. */
export const FIT_WEIGHTS = { business_model: 0.25, operations: 0.2, industry: 0.2, scale: 0.1, offering: 0.25 } as const;
export const DIMENSION_LABEL: Record<LookalikeDimension, string> = {
  business_model: "Business model", operations: "Operations", industry: "Industry", scale: "Scale", offering: "Need for the offering", intent: "Buying intent",
};
/** Candidates found per search before investigation (the best are investigated). */
const FOUND_LIMIT = 25;

/**
 * Lookalike research costs, charged to the account as a whole (no company exists yet).
 * Searches are counted per engine actually queried; AI steps at their usual rates.
 */
export function costMeter(sellerId: string) {
  const searches: string[] = [];
  let llmUsd = 0;
  return {
    onAttempt: (a: { engine: string; error?: string }) => {
      if (!a.error) searches.push(a.engine);
    },
    search: (engine: string) => searches.push(engine),
    llm: (usd: number = CONFIG.costsUsd.llmCheap) => {
      llmUsd += usd;
    },
    /** Write what was used since the last flush. */
    async flush(what: string) {
      const searchUsd = searches.reduce((t, e) => t + (CONFIG.costsUsd.search[e] ?? 0.01), 0);
      const n = searches.length;
      searches.length = 0;
      if (searchUsd > 0) await recordAccountCost(sellerId, "search", searchUsd, `${what}: ${n} search${n === 1 ? "" : "es"}`);
      if (llmUsd > 0) await recordAccountCost(sellerId, "llm", llmUsd, `${what}: AI`);
      llmUsd = 0;
    },
  };
}

/** This client's lookalike criteria, with defaults. */
export function lookalikeCriteria(p: SellerProfile = seller()) {
  const l = p.lookalike ?? {};
  return { focus: l.focus ?? [], avoid: l.avoid ?? [], minFit: l.minFit ?? 55, candidates: l.candidates ?? 8, rounds: l.rounds ?? 3 };
}

/** What the client sells, in a few lines, for the AI to judge relevance against. */
export function offeringOf(p: SellerProfile = seller()) {
  return [p.summary, ...p.useCases.map((u) => `${u.name}: ${u.pains}`)].filter(Boolean).join(" | ").slice(0, 900) || p.name;
}

/** "https://www.acme.co.in/about" → acme.co.in; a plain name stays a name. */
function parseSeed(input: string): { name: string; domain: string | null } {
  const t = input.trim();
  const looksLikeDomain = /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t);
  const domain = looksLikeDomain ? normalizeDomain(t) : null;
  const name = domain ? domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : t;
  return { name, domain };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The reference company's profile as stored on each suggestion. */
export interface SeedRecord {
  industry: string | null;
  employees: number | null;
  country: string | null;
  keywords?: string[];
  profile?: LookalikeProfile;
  /** Company search: must-haves and rule-outs from the confirmed criteria (added to the client's own). */
  focus?: string[];
  avoid?: string[];
}

export interface LookalikeResult {
  seed: string;
  found: number;
  /** Queued for investigation. */
  suggested: number;
  excluded: number;
}

/** Steps 1–2: profile the reference company, discover candidates, queue the best for investigation. */
export async function findLookalikes(input: string, ctx: RunContext = newContext(), requestedBy: string | null = null): Promise<LookalikeResult> {
  const p = seller();
  const crit = lookalikeCriteria(p);
  const offering = offeringOf(p);
  const mode = ctx.adapters.research.live ? "live" : "mock";
  const parsed = parseSeed(input);
  // A search costs a few cents; stop before starting if the account's monthly cap is reached.
  await ensureMonthlyBudget(p.id, 0.05);
  const m = costMeter(p.id);
  const seedName = parsed.name;

  // 1. Profile the reference company.
  let seedPages: ResearchPage[] = [];
  try {
    seedPages = await ctx.adapters.research.search(parsed.domain ?? "", seedName, "lookalike_profile", "main", { query: `${parsed.domain ?? seedName} company overview what it does operations customers`, engine: "exa", onAttempt: m.onAttempt });
  } catch {
    seedPages = [];
  }
  if (seedPages.length) m.llm();
  const profile = (await ctx.adapters.llm.profileCompany(seedPages, seedName, offering).catch(() => null)) ?? null;
  const seedFirmo = await firmographicsFor(ctx, { name: seedName, domain: parsed.domain }, { apollo: false });
  const seedRecord: SeedRecord = { industry: profile?.industry ?? seedFirmo.industry, employees: seedFirmo.employees, country: seedFirmo.country, keywords: [], ...(profile ? { profile } : {}) };
  const country = targetCountries();

  // 2. Discover candidates: Exa similarity, Exa on the business model, Tavily peers.
  const held = await heldKeys();
  const seen = new Set<string>([companyNameKey(seedName)]);
  const found: (Candidate & { reason: string; source?: { url: string; quote: string; at: string } })[] = [];
  const keep = (c: (typeof found)[number]) => {
    const k = companyNameKey(c.name);
    const d = normalizeDomain(c.domain);
    if (!k || seen.has(k) || held.names.has(k) || (d && (held.domains.has(d) || d === parsed.domain))) return;
    seen.add(k);
    found.push(c);
  };
  const batches: { label: string; pages: () => Promise<ResearchPage[]> }[] = [];
  if (parsed.domain && ctx.adapters.research.findSimilar) batches.push({ label: "Exa similar sites", pages: () => (m.search("exa"), ctx.adapters.research.findSimilar!(`https://${parsed.domain}`)) });
  if (profile) batches.push({ label: "Exa business model", pages: () => ctx.adapters.research.search("", "", "lookalike_discover", "main", { query: `companies that ${profile.businessModel}; ${profile.operations}${profile.industry ? `; ${profile.industry}` : ""}${country ? ` in ${country}` : ""}`, engine: "exa", onAttempt: m.onAttempt }) });
  batches.push({ label: "Tavily peers", pages: () => ctx.adapters.research.search("", seedName, "lookalike_discover", "followup", { query: `"${seedName}" competitors OR alternatives OR "companies like"`, engine: "tavily", onAttempt: m.onAttempt }) });
  const industry = seedRecord.industry;
  if (industry) batches.push({ label: "Tavily industry", pages: () => ctx.adapters.research.search("", "", "lookalike_discover", "followup", { query: `leading ${industry} companies ${country}`.trim(), engine: "tavily", onAttempt: m.onAttempt }) });
  for (const b of batches) {
    if (found.length >= FOUND_LIMIT * 2) break;
    let pages: ResearchPage[] = [];
    try {
      pages = await b.pages();
    } catch (e) {
      await logEvent(ctx, { stage: 0, step: "lookalike.discover", outcome: "error", reason: `${b.label}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}` });
      continue;
    }
    if (pages.length) m.llm();
    const items = await ctx.adapters.llm.extractSimilarCompanies(pages, { name: seedName, industry }).catch(() => []);
    for (const it of items) {
      const page = pages[it.page];
      if (!page || !quoteGate(it.quote, page, mode).pass) continue;
      keep({ name: it.name, domain: it.domain ?? (b.label === "Exa similar sites" ? hostOf(page.url) : null), reason: it.reason, source: { url: page.url, quote: it.quote, at: page.publishedAt.toISOString() } });
    }
  }

  // Check the hard targeting rule (no Apollo), then queue the best for investigation.
  let suggested = 0;
  let excluded = 0;
  for (const c of found.slice(0, FOUND_LIMIT)) {
    const firmo = await firmographicsFor(ctx, c, { apollo: false });
    const gate = mustHaveGate({ country: firmo.country, employees: firmo.employees });
    const queue = (gate.pass || gate.unknown) && suggested < crit.candidates;
    const status = await saveSuggestion({
      origin: "lookalike", seed: seedName, candidate: c, firmo, score: 0, level: "cold",
      whyNow: `Similar to ${seedName}: ${c.reason}`,
      sources: c.source ? [{ ...c.source, trigger: "lookalike" }] : [],
      seedProfile: seedRecord,
    });
    if (status === "excluded") excluded++;
    if (status === "new" && queue) {
      await db.prospectSuggestion.update({ where: { sellerId_nameKey: { sellerId: p.id, nameKey: companyNameKey(c.name) } }, data: { researchStatus: "queued", researchNote: null, requestedBy } });
      suggested++;
    } else if (status === "new") {
      // Beyond this client's per-search limit: not recommended, so not shown for approval.
      await db.prospectSuggestion.delete({ where: { sellerId_nameKey: { sellerId: p.id, nameKey: companyNameKey(c.name) } } }).catch(() => undefined);
    }
  }
  await m.flush(`Lookalikes like ${seedName}`);
  await logEvent(ctx, { stage: 0, step: "lookalike.search", outcome: "info", reason: `Companies like ${seedName}: ${found.length} found, ${suggested} queued for investigation, ${excluded} outside the targeting rule` });
  return { seed: seedName, found: found.length, suggested, excluded };
}

// ── Investigation ──

export interface LookalikeEvidence {
  claim: string;
  quote: string;
  url: string;
  publisher: string;
  at: string;
  dimension: LookalikeDimension;
  /** Independent sites stating it. */
  sources: number;
  urls: string[];
  verified: boolean;
}

export interface LookalikeRound {
  round: number;
  why: string;
  questions: { question: string; why: string; dimension: LookalikeDimension; engine: string; query: string; found: number; kept: number }[];
}

export interface LookalikeResearch {
  dims: Record<keyof typeof FIT_WEIGHTS, number>;
  concerns: string[];
  rounds: LookalikeRound[];
  stopReason: string;
  model: string;
  note?: string | null;
  error?: string;
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3));
function overlap(a: string, b: string) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

/** Merge facts that say the same thing; a fact is verified when two sites (or the company's own) state it. */
export function mergeEvidence(facts: Omit<LookalikeEvidence, "sources" | "urls" | "verified">[], companyDomain: string | null): LookalikeEvidence[] {
  const out: LookalikeEvidence[] = [];
  for (const f of facts) {
    const same = out.find((e) => e.dimension === f.dimension && overlap(e.claim, f.claim) >= 0.6);
    if (same) {
      if (!same.urls.includes(f.url)) same.urls.push(f.url);
    } else out.push({ ...f, sources: 0, urls: [f.url], verified: false });
  }
  const own = companyDomain ? normalizeDomain(companyDomain) : null;
  for (const e of out) {
    const hosts = new Set(e.urls.map(hostOf));
    e.sources = hosts.size;
    // The company's own site is authoritative for what it does; events need a second, independent source.
    e.verified = hosts.size >= 2 || (e.dimension !== "intent" && Boolean(own && [...hosts].some((h) => h === own || h.endsWith(`.${own}`))));
  }
  return out;
}

/** Fit and readiness from the judgement, with code-enforced limits on weak evidence. */
export function scoreLookalike(j: { dims: Record<keyof typeof FIT_WEIGHTS, number>; readiness: "ready" | "emerging" | "early" | "none"; readinessScore: number }, evidence: LookalikeEvidence[]) {
  let fit = Math.round(Object.entries(FIT_WEIGHTS).reduce((t, [k, w]) => t + w * Math.max(0, Math.min(100, j.dims[k as keyof typeof FIT_WEIGHTS] ?? 30)), 0));
  const verified = evidence.filter((e) => e.verified);
  // Nothing verified: the match can't be more than a possibility.
  if (!verified.length) fit = Math.min(fit, 50);
  let readiness = j.readiness;
  let readinessScore = Math.max(0, Math.min(100, Math.round(j.readinessScore)));
  const intent = evidence.filter((e) => e.dimension === "intent");
  // "Ready" needs a verified buying event; any readiness above "early" needs at least one event.
  if (readiness === "ready" && !intent.some((e) => e.verified)) readiness = "emerging";
  if ((readiness === "ready" || readiness === "emerging") && !intent.length) readiness = "early";
  const cap = { ready: 100, emerging: 65, early: 35, none: 10 }[readiness];
  readinessScore = Math.min(readinessScore, cap);
  return { fit, readiness, readinessScore };
}

/** Step 3–4 for one suggestion: the AI investigates, then judges. Runs inside the client's context. */
export async function investigateSuggestion(id: string, ctx: RunContext = newContext()): Promise<ProspectSuggestion | null> {
  const s = await db.prospectSuggestion.findUnique({ where: { id } });
  if (!s || !INVESTIGATED_ORIGINS.includes(s.origin)) return null;
  const isSearch = s.origin === "discovery";
  const p = seller();
  const crit = lookalikeCriteria(p);
  const offering = offeringOf(p);
  const mode = ctx.adapters.research.live ? "live" : "mock";
  // Over the account's monthly cap: don't start; say why on the card.
  try {
    await ensureMonthlyBudget(s.sellerId, 0.1);
  } catch (e) {
    if (!(e instanceof MonthlyBudgetExceeded)) throw e;
    return db.prospectSuggestion.update({ where: { id }, data: { researchStatus: "failed", research: { ...((s.research as object | null) ?? {}), rounds: ((s.research as { rounds?: unknown[] } | null)?.rounds ?? []), error: e.message } as unknown as Prisma.InputJsonValue } });
  }
  const m = costMeter(s.sellerId);
  await db.prospectSuggestion.update({ where: { id }, data: { researchStatus: "running" } });

  const seedRec = (s.seedProfile ?? {}) as unknown as SeedRecord;
  // A company search is judged against the confirmed criteria, written as a reference profile.
  const seed = { name: isSearch ? "the companies described in the search" : s.seed ?? "the reference company", ...(seedRec.profile ?? { summary: s.seed ?? "", businessModel: "unknown", operations: "unknown", industry: seedRec.industry, customers: "unknown", scale: "unknown", offeringFit: "unknown" }) };
  const focus = [...crit.focus, ...(seedRec.focus ?? [])];
  const avoid = [...crit.avoid, ...(seedRec.avoid ?? [])];
  const company = { name: s.name, domain: s.domain };
  const prev = (s.research ?? null) as LookalikeResearch | null;
  const raw: Omit<LookalikeEvidence, "sources" | "urls" | "verified">[] = ((s.evidence ?? []) as unknown as LookalikeEvidence[]).flatMap((e) => e.urls.map((url) => ({ claim: e.claim, quote: e.quote, url, publisher: hostOf(url), at: e.at, dimension: e.dimension })));
  const rounds: LookalikeRound[] = prev?.rounds ? [...prev.rounds] : [];
  const asked = rounds.flatMap((r) => r.questions.map((q) => q.question));
  // A "research more" request gets two more rounds on top of what was done.
  const start = rounds.length + 1;
  const maxRounds = s.researchNote ? rounds.length + 2 : crit.rounds;
  let stopReason = "Round limit reached";
  const known = (): LookalikeKnownFact[] => mergeEvidence(raw, s.domain).map((e) => ({ claim: e.claim, dimension: e.dimension, verified: e.verified }));

  try {
    for (let round = start; round <= maxRounds; round++) {
      m.llm();
      const plan = await ctx.adapters.llm.planLookalike({ seed, company, offering, focus, avoid, facts: known(), asked, note: round === start ? s.researchNote : null, round, maxRounds });
      const done: LookalikeRound = { round, why: plan.why, questions: [] };
      for (const q of plan.questions.filter((x) => !asked.includes(x.question)).slice(0, 4)) {
        asked.push(q.question);
        const pages = await searchFor(ctx, company, q, m.onAttempt);
        if (pages.length) m.llm();
        const facts = pages.length ? await ctx.adapters.llm.extractLookalikeFacts(pages, s.name, q).catch(() => []) : [];
        let kept = 0;
        for (const f of facts) {
          const page = pages[f.page];
          if (!page || !quoteGate(f.quote, page, mode).pass) continue;
          raw.push({ claim: f.claim, quote: f.quote, url: page.url, publisher: hostOf(page.url), at: page.publishedAt.toISOString(), dimension: f.dimension });
          kept++;
        }
        done.questions.push({ question: q.question, why: q.why, dimension: q.dimension, engine: q.engine, query: q.query, found: pages.length, kept });
      }
      if (done.questions.length) rounds.push(done);
      if (plan.done || !done.questions.length) {
        stopReason = plan.done ? plan.why || "Enough evidence to judge" : "No new questions worth asking";
        break;
      }
    }

    const evidence = mergeEvidence(raw, s.domain);
    m.llm(CONFIG.costsUsd.llmBrain);
    const j = await ctx.adapters.llm.judgeLookalike({ seed, company, offering, focus, avoid, facts: evidence.map((e) => ({ claim: e.claim, dimension: e.dimension, verified: e.verified })) });
    const { fit, readiness, readinessScore } = scoreLookalike(j, evidence);
    const gate = mustHaveGate({ country: s.country, employees: s.employees });
    const ruled = !gate.pass && !gate.unknown ? gate.reason : j.avoidHit ? `Matches a rule-out for this account: ${j.avoidHit}` : fit < crit.minFit ? `Fit ${fit} is below this account's minimum of ${crit.minFit}` : null;
    const research: LookalikeResearch = { dims: j.dims, concerns: j.concerns, rounds, stopReason, model: ctx.adapters.llm.model, note: s.researchNote };
    const updated = await db.prospectSuggestion.update({
      where: { id },
      data: {
        fitScore: fit, readiness, readinessScore, score: fit, reasons: j.reasons.slice(0, 5),
        level: readiness === "ready" ? "hot" : readiness === "emerging" ? "warm" : "cold",
        whyNow: (j.reasons[0] ? `${isSearch ? "Matches your search" : `Similar to ${seed.name}`}: ${j.reasons[0]}` : s.whyNow).slice(0, 400),
        evidence: evidence as unknown as Prisma.InputJsonValue, research: research as unknown as Prisma.InputJsonValue,
        researchStatus: "done", researchedAt: new Date(), researchNote: null,
        // A person's decision is never overwritten; otherwise the rule-outs set it aside.
        ...(s.status === "new" || s.status === "excluded" ? { status: ruled ? "excluded" : "new", reason: ruled } : {}),
      },
    });
    await logEvent(ctx, { stage: 0, step: "lookalike.investigate", outcome: "info", reason: `${s.name}: fit ${fit}, ${readiness}, ${evidence.length} facts (${evidence.filter((e) => e.verified).length} verified), ${rounds.length} rounds` });
    await m.flush(`Lookalike research: ${s.name}`);
    return updated;
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "Investigation failed";
    await recordError("lookalike investigation", e, s.name);
    await logEvent(ctx, { stage: 0, step: "lookalike.investigate", outcome: "error", reason: `${s.name}: ${msg}` });
    await m.flush(`Lookalike research: ${s.name}`).catch(() => undefined);
    return db.prospectSuggestion.update({ where: { id }, data: { researchStatus: "failed", research: { ...(prev ?? {}), rounds, error: msg } as unknown as Prisma.InputJsonValue } });
  }
}

/** One question → pages: company facts from profile-style searches, events from news. */
async function searchFor(ctx: RunContext, company: { name: string; domain: string | null }, q: LookalikeQuestion, onAttempt?: (a: { engine: string; results: number; error?: string }) => void): Promise<ResearchPage[]> {
  const key = q.dimension === "intent" ? "lookalike_intent" : "lookalike_profile";
  try {
    return await ctx.adapters.research.search(company.domain ?? "", company.name, key, "main", { query: q.query, engine: q.engine, onAttempt });
  } catch {
    return [];
  }
}

/** "Research more": a person asks the AI to look into something; it runs in the background. */
export async function requestMoreResearch(id: string, note: string | null) {
  return db.prospectSuggestion.update({ where: { id }, data: { researchStatus: "queued", researchNote: note?.trim().slice(0, 300) || "Look for more evidence on fit and buying intent" } });
}

/** Background work: investigate queued lookalikes, each in its own client's context. */
export async function processLookalikeQueue(opts: { budgetMs: number; ctx?: RunContext }): Promise<{ processed: number; remaining: number }> {
  const until = Date.now() + opts.budgetMs;
  let processed = 0;
  while (Date.now() < until) {
    const next = await db.prospectSuggestion.findFirst({ where: { origin: { in: INVESTIGATED_ORIGINS }, researchStatus: "queued" }, orderBy: { updatedAt: "asc" }, select: { id: true, sellerId: true } });
    if (!next) break;
    try {
      await withSeller(next.sellerId, () => investigateSuggestion(next.id, opts.ctx ?? newContext()));
    } catch (e) {
      // The client's settings couldn't load: mark it so the queue moves on.
      await db.prospectSuggestion.update({ where: { id: next.id }, data: { researchStatus: "failed", research: { rounds: [], error: e instanceof Error ? e.message.slice(0, 300) : "Could not load this account's settings" } } });
    }
    processed++;
  }
  // A run that died mid-way leaves "running" behind: retry those after 15 minutes.
  await db.prospectSuggestion.updateMany({ where: { origin: { in: INVESTIGATED_ORIGINS }, researchStatus: "running", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { researchStatus: "queued" } });
  const remaining = await db.prospectSuggestion.count({ where: { origin: { in: INVESTIGATED_ORIGINS }, researchStatus: "queued" } });
  return { processed, remaining };
}
