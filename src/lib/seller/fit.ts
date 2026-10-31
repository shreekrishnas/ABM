// Seller-aware account intelligence: fit scoring with reasons, industry and
// use-case matching, persona (buying role) matching and trigger classification.
// Pure functions — no database access.

import type { SellerProfile } from "./types";

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
// Whole-word match that also accepts simple plurals ("beverage" ↔ "beverages").
const has = (text: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(s|es)?([^a-z0-9]|$)`, "i").test(text));

export function matchIndustry(industry: string | null | undefined, p: SellerProfile) {
  const t = lc(industry);
  if (!t) return null;
  return p.icp.industries.find((i) => has(t, i.match)) ?? null;
}

export interface FitInput {
  industry?: string | null;
  employees?: number | null;
  country?: string | null;
  technologies?: string[] | null;
  /** What research has established (stage 6–7). Absent before research: those components are unknown. */
  research?: FitResearch;
}

/** Research-backed fit inputs, read from the database by the pipeline (see pipeline/fit-research.ts). */
export interface FitResearch {
  /** Size of the external network (distributors, dealers, retailers, vendors, sellers). */
  partnerNetwork?: number | null;
  /** How the company goes to market, as researched. */
  businessModel?: string | null;
  /** Strongest supported or validated investigation class that links the company to one of the seller's use cases. */
  solutionClass?: string | null;
  /** The use case that conclusion is about. */
  solutionUseCase?: string | null;
  financialHealth?: string | null;
  /** A funding round announced in the last 24 months. */
  recentFunding?: boolean;
  /** Similarity to the seller's won customers (0–1) and what matched; null when there aren't enough wins. */
  winSimilarity?: { score: number; matched: string[]; wins: number } | null;
  /** Won deals on record and how many are needed before customer likeness is scored. */
  wins?: { have: number; needed: number };
}

export const DEFAULT_RESEARCH_WEIGHTS = { solutionRelevance: 20, financialCapacity: 10, customerLikeness: 15 };

const SOLUTION_SHARE: Record<string, { share: number; text: string }> = {
  direct_intent: { share: 1, text: "a source says they are evaluating this kind of solution" },
  supported_opportunity: { share: 0.85, text: "several connected facts support a specific need" },
  relevant_development: { share: 0.55, text: "a development plausibly relates to the offering" },
  verified_event: { share: 0.25, text: "an event is confirmed but not yet linked to a need" },
  irrelevant: { share: 0, text: "research found no defensible link to the offering" },
};

const HEALTH_SHARE: Record<string, { share: number; text: string }> = {
  profitable_growing: { share: 1, text: "profitable and growing" },
  profitable: { share: 0.85, text: "profitable" },
  breakeven: { share: 0.55, text: "around breakeven" },
  declining: { share: 0.3, text: "revenue declining" },
  loss_making: { share: 0.2, text: "loss-making" },
};

export interface FitComponent {
  key: "industry" | "size" | "geography" | "techStack" | "partnerNetwork" | "businessModel" | "solutionRelevance" | "financialCapacity" | "customerLikeness";
  label: string;
  points: number | null; // null = unknown (not counted)
  max: number;
  reason: string;
}

export interface SellerFit {
  /** 0–100 on known components only; null when nothing is known. */
  fit: number | null;
  coverage: number;
  components: FitComponent[];
  reasons: string[];
  industryKey: string | null;
  useCases: string[];
}

/** Fit of a prospect for the active seller, with a plain-language reason per component. */
export function sellerFit(a: FitInput, p: SellerProfile): SellerFit {
  const w = p.icp.weights;
  const ind = matchIndustry(a.industry, p);
  const components: FitComponent[] = [];

  // Industry: primary verticals score full, secondary partial — unless the seller targets any industry.
  if (p.icp.industryMode === "any") components.push({ key: "industry", label: "Industry", points: null, max: w.industry, reason: a.industry ? `${a.industry} — any industry qualifies` : "Any industry qualifies" });
  else if (!a.industry) components.push({ key: "industry", label: "Industry", points: null, max: w.industry, reason: "Industry unknown" });
  else if (!ind) components.push({ key: "industry", label: "Industry", points: Math.round(w.industry * 0.15), max: w.industry, reason: `${a.industry} is outside ${p.name}'s target verticals` });
  else components.push({ key: "industry", label: "Industry", points: ind.tier === "primary" ? w.industry : Math.round(w.industry * 0.65), max: w.industry, reason: `${ind.label} — ${ind.tier} vertical` });

  // Size: enterprises with large partner/vendor networks.
  const e = a.employees;
  const s = p.icp.employees;
  if (e == null) components.push({ key: "size", label: "Company size", points: null, max: w.size, reason: "Employee count unknown" });
  else {
    const pts = e >= s.sweetSpot ? w.size : e >= s.mid ? Math.round(w.size * 0.72) : e >= s.min ? Math.round(w.size * 0.32) : 0;
    const band = e >= s.sweetSpot ? "enterprise sweet spot" : e >= s.mid ? "upper mid-market" : e >= s.min ? "small for enterprise MDM" : "too small";
    components.push({ key: "size", label: "Company size", points: pts, max: w.size, reason: `${e.toLocaleString()} employees — ${band}` });
  }

  // Geography: the seller's primary markets first, secondary markets next.
  const c = (a.country ?? "").toUpperCase();
  if (!c) components.push({ key: "geography", label: "Geography", points: null, max: w.geography, reason: "Country unknown" });
  else if (p.icp.geos.primary.includes(c)) components.push({ key: "geography", label: "Geography", points: w.geography, max: w.geography, reason: `${c} — home market` });
  else if (p.icp.geos.secondary.includes(c)) components.push({ key: "geography", label: "Geography", points: Math.round(w.geography * 0.67), max: w.geography, reason: `${c} — expansion market` });
  else components.push({ key: "geography", label: "Geography", points: Math.round(w.geography * 0.2), max: w.geography, reason: `${c} — outside current markets` });

  // Tech stack: ERP to integrate with, incumbents to displace, DIY workflow tools.
  const tech = (a.technologies ?? []).map(lc).join(" | ");
  if (!tech) components.push({ key: "techStack", label: "Tech stack", points: null, max: w.techStack, reason: "Tech stack unknown" });
  else {
    const erp = p.icp.tech.erp.filter((t) => tech.includes(t));
    const inc = p.icp.tech.incumbents.filter((t) => tech.includes(t));
    const wf = p.icp.tech.workflow.filter((t) => tech.includes(t));
    const pts = Math.min(w.techStack, (erp.length ? 6 : 0) + (inc.length ? 3 : 0) + (wf.length ? 1 : 0) + (erp.length || inc.length || wf.length ? 0 : 2));
    const parts = [erp.length ? `ERP to integrate (${erp[0].toUpperCase()})` : null, inc.length ? `legacy MDM to replace (${inc[0]})` : null, wf.length ? `DIY workflow tools (${wf[0]})` : null].filter(Boolean);
    components.push({ key: "techStack", label: "Tech stack", points: pts, max: w.techStack, reason: parts.length ? parts.join(", ") : "No ERP/MDM signals in the stack" });
  }

  // ── Research-backed components (unknown until research has run) ──
  const r = a.research ?? {};
  const pct = (share: number, max: number) => Math.round(share * max);

  // Partner network: larger external networks mean more onboarding and master data.
  if (w.partnerNetwork) {
    const bands = p.icp.partnerNetwork ?? { strong: 5000, good: 1000, min: 100 };
    const n = r.partnerNetwork ?? null;
    if (n == null) components.push({ key: "partnerNetwork", label: "Partner network", points: null, max: w.partnerNetwork, reason: "Network size not found yet" });
    else {
      const [share, band] = n >= bands.strong ? [1, "large network"] : n >= bands.good ? [0.7, "sizeable network"] : n >= bands.min ? [0.35, "small network"] : [0.1, "very small network"];
      components.push({ key: "partnerNetwork", label: "Partner network", points: pct(share as number, w.partnerNetwork), max: w.partnerNetwork, reason: `About ${n.toLocaleString()} partners — ${band}` });
    }
  }

  // Business model: only when the seller names the models it sells into.
  const bmWeight = w.businessModel ?? 0;
  if (bmWeight && p.icp.businessModels?.length) {
    const bm = r.businessModel ?? null;
    if (!bm) components.push({ key: "businessModel", label: "Business model", points: null, max: bmWeight, reason: "Go-to-market model not found yet" });
    else {
      const hit = p.icp.businessModels.find((m) => has(lc(bm), m.match));
      const share = !hit ? 0.15 : hit.tier === "primary" ? 1 : 0.6;
      components.push({ key: "businessModel", label: "Business model", points: pct(share, bmWeight), max: bmWeight, reason: hit ? `${hit.label} — ${hit.tier} model` : `${bm.slice(0, 60)} — not a target model` });
    }
  }

  // Solution relevance: does research show the problem the offering solves?
  const srWeight = w.solutionRelevance ?? DEFAULT_RESEARCH_WEIGHTS.solutionRelevance;
  if (srWeight) {
    const c = r.solutionClass ? SOLUTION_SHARE[r.solutionClass] : undefined;
    const uc = r.solutionUseCase ? p.useCases.find((u) => u.key === r.solutionUseCase)?.name ?? r.solutionUseCase : null;
    components.push(c
      ? { key: "solutionRelevance", label: "Solution relevance", points: pct(c.share, srWeight), max: srWeight, reason: `${c.text[0].toUpperCase()}${c.text.slice(1)}${uc ? ` (${uc})` : ""}` }
      : { key: "solutionRelevance", label: "Solution relevance", points: null, max: srWeight, reason: "No investigation conclusion yet" });
  }

  // Financial capacity: can it pay for a programme now?
  const fcWeight = w.financialCapacity ?? DEFAULT_RESEARCH_WEIGHTS.financialCapacity;
  if (fcWeight) {
    const h = r.financialHealth && r.financialHealth !== "unknown" ? HEALTH_SHARE[r.financialHealth] : undefined;
    if (h) {
      // A loss-making company that raised money recently has budget to spend.
      const share = r.financialHealth === "loss_making" && r.recentFunding ? 0.7 : h.share;
      components.push({ key: "financialCapacity", label: "Financial capacity", points: pct(share, fcWeight), max: fcWeight, reason: `${h.text[0].toUpperCase()}${h.text.slice(1)}${r.recentFunding ? ", raised funding in the last 24 months" : ""}` });
    } else if (r.recentFunding) components.push({ key: "financialCapacity", label: "Financial capacity", points: pct(0.7, fcWeight), max: fcWeight, reason: "Raised funding in the last 24 months; financials unknown" });
    else components.push({ key: "financialCapacity", label: "Financial capacity", points: null, max: fcWeight, reason: "Financials not found yet" });
  }

  // Customer likeness: resembles the seller's won customers.
  const clWeight = w.customerLikeness ?? DEFAULT_RESEARCH_WEIGHTS.customerLikeness;
  if (clWeight) {
    const ws = r.winSimilarity;
    components.push(ws
      ? { key: "customerLikeness", label: "Like won customers", points: pct(ws.score, clWeight), max: clWeight, reason: `${Math.round(ws.score * 100)}% similar to the closest of ${ws.wins} won customers${ws.matched.length ? ` (${ws.matched.join(", ")})` : ""}` }
      : { key: "customerLikeness", label: "Like won customers", points: null, max: clWeight, reason: r.wins ? `Needs ${r.wins.needed} won deals to compare (have ${r.wins.have})` : "Not compared yet" });
  }

  const known = components.filter((x) => x.points !== null);
  const knownMax = known.reduce((t, x) => t + x.max, 0);
  const got = known.reduce((t, x) => t + (x.points ?? 0), 0);
  return {
    fit: knownMax ? Math.round((got / knownMax) * 100) : null,
    // Coverage is about the firmographics we hold (it feeds data confidence); research components fill in later.
    coverage: (() => {
      const firmo = components.filter((x) => ["industry", "size", "geography", "techStack"].includes(x.key));
      return firmo.length ? firmo.filter((x) => x.points !== null).length / firmo.length : 0;
    })(),
    components,
    reasons: components.map((x) => `${x.label}: ${x.points === null ? "unknown" : `${x.points}/${x.max}`} — ${x.reason}`),
    industryKey: ind?.key ?? null,
    useCases: ind?.useCases ?? [],
  };
}

/** Persona match for a title → buying role, with why. Most specific persona wins. */
export function matchPersona(title: string | null | undefined, p: SellerProfile) {
  const t = lc(title);
  if (!t) return null;
  const order = ["champion", "decision_maker", "budget_owner", "influencer"] as const;
  const hits = p.personas.filter((x) => has(t, x.titles));
  if (!hits.length) return null;
  // Prefer longer (more specific) title phrases, then role order.
  hits.sort((a, b) => Math.max(...b.titles.filter((x) => has(t, [x])).map((x) => x.length)) - Math.max(...a.titles.filter((x) => has(t, [x])).map((x) => x.length)) || order.indexOf(a.role) - order.indexOf(b.role));
  return hits[0];
}

/** Which of the seller's buying triggers a piece of evidence matches. */
export function classifyTrigger(text: string, p: SellerProfile) {
  const t = lc(text);
  return p.triggers.find((tr) => has(t, tr.keywords)) ?? null;
}

/** The use case to lead with for an account: from its trigger first, then its industry. */
export function pickUseCase(industry: string | null | undefined, triggerKey: string | null, p: SellerProfile): string | null {
  const ind = matchIndustry(industry, p);
  const t = triggerKey ? p.triggers.find((x) => x.key === triggerKey) : null;
  if (t?.useCase && (!ind || ind.useCases.includes(t.useCase) || t.leadsAlways)) return t.useCase;
  return ind?.useCases[0] ?? null;
}
