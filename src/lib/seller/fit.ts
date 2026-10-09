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
}

export interface FitComponent {
  key: "industry" | "size" | "geography" | "partnerNetwork" | "techStack";
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

  // Geography: India first; GCC, US/UK and SE Asia second.
  const c = (a.country ?? "").toUpperCase();
  if (!c) components.push({ key: "geography", label: "Geography", points: null, max: w.geography, reason: "Country unknown" });
  else if (p.icp.geos.primary.includes(c)) components.push({ key: "geography", label: "Geography", points: w.geography, max: w.geography, reason: `${c} — home market` });
  else if (p.icp.geos.secondary.includes(c)) components.push({ key: "geography", label: "Geography", points: Math.round(w.geography * 0.67), max: w.geography, reason: `${c} — expansion market` });
  else components.push({ key: "geography", label: "Geography", points: Math.round(w.geography * 0.2), max: w.geography, reason: `${c} — outside current markets` });

  // Partner network intensity: how many external parties the business onboards.
  if (p.icp.industryMode === "any") components.push({ key: "partnerNetwork", label: "Partner network", points: null, max: w.partnerNetwork, reason: "Not judged by industry (research checks the real network)" });
  else if (!ind) components.push({ key: "partnerNetwork", label: "Partner network", points: a.industry ? 0 : null, max: w.partnerNetwork, reason: a.industry ? "No large distributor/vendor/gig network expected" : "Unknown until industry is known" });
  else components.push({ key: "partnerNetwork", label: "Partner network", points: Math.round(w.partnerNetwork * ind.partnerIntensity), max: w.partnerNetwork, reason: ind.partnerIntensity >= 0.9 ? "Large distributor/vendor/seller network typical" : "Meaningful partner and vendor network typical" });

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

  const known = components.filter((x) => x.points !== null);
  const knownMax = known.reduce((t, x) => t + x.max, 0);
  const got = known.reduce((t, x) => t + (x.points ?? 0), 0);
  return {
    fit: knownMax ? Math.round((got / knownMax) * 100) : null,
    coverage: known.length / components.length,
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
  const byTrigger: Record<string, string> = { channel_expansion: "distributor_onboarding", workforce_scale: "gig_onboarding", compliance_mandate: "regulated_kyc", mdm_replacement: "customer_master", erp_migration: "vendor_onboarding", ma_integration: "customer_master" };
  const ind = matchIndustry(industry, p);
  if (triggerKey && byTrigger[triggerKey] && (!ind || ind.useCases.includes(byTrigger[triggerKey]) || triggerKey === "mdm_replacement")) return byTrigger[triggerKey];
  return ind?.useCases[0] ?? null;
}
