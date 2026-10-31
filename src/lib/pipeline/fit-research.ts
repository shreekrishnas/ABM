// Research-backed fit inputs, read from what the pipeline has established, and the re-score that
// runs once research is in (end of stage 7, and after a profile refresh or a filed record).
//
// Customer likeness compares a company with the seller's WON customers on five traits: industry,
// size band, home/expansion/other market, technology categories and business model. Each trait
// known on both sides scores 1 (same), 0.5 (adjacent size band) or 0; a won customer's similarity
// is the average over the traits both share; the company's score is the mean of its 3 closest
// won customers. It is only scored with at least CONFIG.fit.winModelMin won deals.

import type { Account } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { sellerFor, seller } from "@/lib/seller";
import type { SellerProfile } from "@/lib/seller/types";
import { matchIndustry, type FitResearch } from "@/lib/seller/fit";
import { matchTech } from "@/lib/profile/catalog";
import { logEvent, type RunContext } from "./context";
import { scoreFit } from "./scoring";

const DAY = 86_400_000;
const CLASS_RANK = ["irrelevant", "verified_event", "relevant_development", "supported_opportunity", "direct_intent"];

interface Traits { industry: string | null; size: number | null; geo: string | null; tech: Set<string>; model: string | null }

function sizeBand(e: number | null | undefined, p: SellerProfile): number | null {
  if (e == null) return null;
  const s = p.icp.employees;
  return e >= s.sweetSpot ? 3 : e >= s.mid ? 2 : e >= s.min ? 1 : 0;
}

function geoBand(country: string | null | undefined, p: SellerProfile): string | null {
  const c = (country ?? "").toUpperCase();
  if (!c) return null;
  return p.icp.geos.primary.includes(c) ? "home" : p.icp.geos.secondary.includes(c) ? "expansion" : "other";
}

function techCategories(names: string[]): Set<string> {
  return new Set(names.map((n) => matchTech(n)?.category).filter((c): c is NonNullable<typeof c> => Boolean(c) && c !== "analytics" && c !== "cms" && c !== "cloud"));
}

function traitsOf(a: { industry: string | null; employees: number | null; country: string | null; technologies: string[]; businessModel: string | null }, p: SellerProfile): Traits {
  return { industry: matchIndustry(a.industry, p)?.key ?? (a.industry ? a.industry.toLowerCase() : null), size: sizeBand(a.employees, p), geo: geoBand(a.country, p), tech: techCategories(a.technologies), model: a.businessModel };
}

/** Similarity of two companies (0–1) over the traits both have, and which traits matched. */
export function similarity(x: Traits, y: Traits): { score: number; matched: string[] } {
  const parts: { name: string; v: number }[] = [];
  if (x.industry && y.industry) parts.push({ name: "industry", v: x.industry === y.industry ? 1 : 0 });
  if (x.size != null && y.size != null) parts.push({ name: "size", v: x.size === y.size ? 1 : Math.abs(x.size - y.size) === 1 ? 0.5 : 0 });
  if (x.geo && y.geo) parts.push({ name: "market", v: x.geo === y.geo ? 1 : 0 });
  if (x.tech.size && y.tech.size) {
    const inter = [...x.tech].filter((t) => y.tech.has(t)).length;
    parts.push({ name: "systems", v: inter / new Set([...x.tech, ...y.tech]).size });
  }
  if (x.model && y.model) parts.push({ name: "business model", v: x.model === y.model ? 1 : 0 });
  if (parts.length < 2) return { score: 0, matched: [] };
  return { score: parts.reduce((t, p) => t + p.v, 0) / parts.length, matched: parts.filter((p) => p.v >= 0.5).map((p) => p.name) };
}

/** Everything research has established that fit can use, for one company. */
export async function fitResearchFor(account: Account, now = new Date()): Promise<FitResearch> {
  const p = (() => { try { return sellerFor(account.sellerId); } catch { return seller(); } })();
  const [partner, model, hyps, recentRound, wonAccounts] = await Promise.all([
    db.evidence.findFirst({ where: { accountId: account.id, key: "partner_network", supersededById: null, flagged: false, status: { in: ["verified", "probable"] }, value: { not: null } }, orderBy: [{ status: "asc" }, { publishedAt: "desc" }], select: { value: true } }),
    db.evidence.findFirst({ where: { accountId: account.id, key: "business_model", supersededById: null, flagged: false, status: { in: ["verified", "probable"] } }, orderBy: [{ status: "asc" }, { publishedAt: "desc" }], select: { value: true, claim: true } }),
    db.hypothesis.findMany({ where: { accountId: account.id, status: { in: ["supported", "validated"] } }, select: { classification: true, useCase: true } }),
    db.fundingRound.findFirst({ where: { accountId: account.id, announcedAt: { gte: new Date(now.getTime() - 730 * DAY) }, stage: { notIn: ["debt", "grant"] } }, select: { id: true } }),
    db.account.findMany({ where: { sellerId: account.sellerId, id: { not: account.id }, mergedIntoId: null, opportunities: { some: { stage: "won" } } }, select: { industry: true, employees: true, country: true, technologies: true, businessModel: true }, take: 500 }),
  ]);
  // Strongest conclusion that ties the company to a use case (an unrelated "irrelevant" verdict counts only when nothing better exists).
  const ranked = hyps.filter((h) => CLASS_RANK.includes(h.classification)).sort((a, b) => CLASS_RANK.indexOf(b.classification) - CLASS_RANK.indexOf(a.classification));
  const best = ranked.find((h) => h.useCase) ?? ranked.find((h) => h.classification === "irrelevant") ?? null;
  const needed = CONFIG.fit.winModelMin;
  let winSimilarity: FitResearch["winSimilarity"] = null;
  if (wonAccounts.length >= needed) {
    const me = traitsOf({ ...account, businessModel: account.businessModel }, p);
    const sims = wonAccounts.map((w) => similarity(me, traitsOf(w, p))).sort((a, b) => b.score - a.score).slice(0, 3);
    const score = sims.reduce((t, s) => t + s.score, 0) / sims.length;
    const matched = [...new Set(sims.flatMap((s) => s.matched))];
    winSimilarity = { score: Math.round(score * 100) / 100, matched, wins: wonAccounts.length };
  }
  const n = partner?.value ? Number(partner.value.replace(/[^\d]/g, "")) : NaN;
  return {
    partnerNetwork: Number.isFinite(n) && n > 0 ? n : null,
    businessModel: model?.value ?? model?.claim ?? null,
    solutionClass: best?.classification ?? null,
    solutionUseCase: best?.useCase ?? null,
    financialHealth: account.financialHealth,
    recentFunding: Boolean(recentRound),
    winSimilarity,
    wins: { have: wonAccounts.length, needed },
  };
}

/** Fit again with research in: score and reasons update; the tier is left to stage 3 and hot intent. */
export async function rescoreFit(account: Account, ctx?: RunContext): Promise<Account> {
  const research = await fitResearchFor(account, ctx?.now);
  const fit = scoreFit({ ...account, research });
  const p = (() => { try { return sellerFor(account.sellerId); } catch { return seller(); } })();
  const model = research.businessModel ? p.icp.businessModels?.find((m) => new RegExp(m.match.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i").test(research.businessModel!))?.key ?? null : null;
  const updated = await db.account.update({ where: { id: account.id }, data: { fitScore: fit.fit, fitReasons: fit.reasons, ...(model ? { businessModel: model } : {}) } });
  if (ctx && fit.fit !== account.fitScore) {
    const added = fit.components.filter((c) => c.points !== null && !["industry", "size", "geography", "techStack"].includes(c.key));
    await logEvent(ctx, { accountId: account.id, stage: 7, step: "fit_tier.research_fit", outcome: "info", reason: `Fit ${account.fitScore ?? "n/a"} → ${fit.fit ?? "n/a"} with research: ${added.map((c) => `${c.label} ${c.points}/${c.max}`).join(", ") || "no research components known yet"}`, data: { components: fit.components.map((c) => ({ key: c.key, points: c.points, max: c.max, reason: c.reason })) } });
  }
  return updated;
}
