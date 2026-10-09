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
const RESCAN_DAYS = 7;

export const bucketOf = (industry: string | null | undefined) => matchIndustry(industry, seller())?.key ?? "other";

export function bucketLabel(key: string) {
  return seller().icp.industries.find((i) => i.key === key)?.label ?? "Other industries";
}

/** Trigger → intent family, so different kinds of events converge rather than pile up. */
const FAMILY: Record<string, IntentFamily> = { erp_migration: "programme", mdm_replacement: "programme", workforce_scale: "hiring", leadership_change: "leadership" };

/** The searches one scan runs: one per seller trigger, one per industry. */
export function marketQueries() {
  const p = seller();
  const country = p.icp.mustHave?.countries?.includes("IN") ? "India" : "";
  const triggers = p.triggers.map((t) => ({ key: `market:${t.key}`, query: `${country} company (${t.keywords.slice(0, 5).map((k) => `"${k}"`).join(" OR ")})`.trim() }));
  const events = p.triggers.map((t) => `"${t.keywords[0]}"`).join(" OR ");
  const industries = p.icp.industries.map((i) => ({ key: `market:ind:${i.key}`, query: `${country} ${i.match.slice(0, 3).map((k) => `"${k}"`).join(" OR ")} (${events})`.trim() }));
  return [...triggers, ...industries];
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
  const country = p.icp.mustHave?.countries?.includes("IN") ? "India" : "";
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
      const triggerKey = p.triggers.some((t) => t.key === f.triggerKey) ? f.triggerKey : "other";
      const data = { company: f.company, industry: f.industry, bucket: bucketOf(f.industry), triggerKey, claim: f.claim.slice(0, 300), quote: f.quote.slice(0, 400), publishedAt: page.publishedAt };
      await db.marketEvent.upsert({ where: { sellerId_sourceUrl_nameKey: { sellerId: p.id, sourceUrl: page.url, nameKey } }, create: { sellerId: p.id, nameKey, sourceUrl: page.url, ...data }, update: data });
      events++;
    }
  }
  const out = await buildSuggestions(ctx);
  await logEvent(ctx, { stage: 0, step: "discover.scan", outcome: "info", reason: `${events} market events; ${out.suggestions} new companies suggested, ${out.excluded} outside the targeting rule`, data: { searches: queries.length } });
  await publish(ctx, { type: "market.scanned", module: "discover", payload: { searches: queries.length, events, ...out } });
  return { searches: queries.length, events, ...out };
}

/** Groups recent market events by company, skips companies already held, checks the rule, scores intent. */
async function buildSuggestions(ctx: RunContext): Promise<{ suggestions: number; excluded: number }> {
  const p = seller();
  const since = new Date(ctx.now.getTime() - 90 * DAY);
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
    if (prev && (prev.status === "added" || prev.status === "dismissed")) continue;
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
    const signals: IntentSignal[] = evs.map((e) => ({
      family: FAMILY[e.triggerKey] ?? "trigger",
      label: e.claim,
      strength: 1,
      at: e.publishedAt,
      refs: [e.id],
      trigger: e.triggerKey,
    }));
    const reading = scoreIntent(signals);
    const sources = evs.slice(0, 5).map((e) => ({ url: e.sourceUrl, quote: e.quote, at: e.publishedAt.toISOString(), trigger: e.triggerKey }));
    const status = gate.pass ? "new" : gate.unknown ? "new" : "excluded";
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
      reason: gate.pass ? null : gate.reason,
    };
    await db.prospectSuggestion.upsert({ where: { sellerId_nameKey: { sellerId: p.id, nameKey } }, create: { sellerId: p.id, nameKey, ...data }, update: data });
    if (status === "excluded") excluded++;
    else suggestions++;
  }
  return { suggestions, excluded };
}

/** Weekly from the tick; never twice inside RESCAN_DAYS. */
export async function maybeScanMarket(ctx: RunContext) {
  await ensureSellerPacks();
  const last = await db.marketEvent.findFirst({ where: { sellerId: seller().id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && ctx.now.getTime() - last.createdAt.getTime() < RESCAN_DAYS * DAY) return false;
  await scanMarket(ctx);
  return true;
}

/** Adds a suggestion as a company; the import queues it for the normal research run. */
export async function addSuggestion(id: string) {
  const s = await db.prospectSuggestion.findUniqueOrThrow({ where: { id } });
  if (s.status === "added" && s.accountId) return s.accountId;
  const res = await ingestRows(
    [{ "Company Name": s.name, ...(s.domain ? { "Company Website": s.domain } : {}), ...(s.industry ? { Industry: s.industry } : {}), ...(s.employees != null ? { "Employee Size": String(s.employees) } : {}), ...(s.country ? { Country: s.country } : {}) }],
    { source: "discover", filename: `discover-${s.name}` },
  );
  const accountId = res.accountIds[0] ?? null;
  await db.prospectSuggestion.update({ where: { id }, data: { status: "added", accountId } });
  return accountId;
}

export async function dismissSuggestion(id: string) {
  await db.prospectSuggestion.update({ where: { id }, data: { status: "dismissed" } });
}
