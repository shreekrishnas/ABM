// The Account Brain: the seller pack, shown as sections people can edit item by item.
// Every save is a SellerPackRevision (nothing is overwritten). A brain that is missing
// required parts is still saved, as a draft: runs keep using the last complete version
// (or, for a new account, do not run) until the problems are fixed.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { builtInPack, ensureSellerPacks, hashPack } from "./index";
import { validatePack } from "./schema";
import { changedSections } from "./diff";
import type { SellerProfile } from "./types";

export type FieldKind = "text" | "long" | "list" | "lines" | "number" | "bool" | "select";
export interface BrainField { key: string; label: string; kind: FieldKind; options?: { value: string; label: string }[]; placeholder?: string; hint?: string; need?: "research" | "email" }
export type BrainItem = Record<string, string | string[] | number | boolean | null> & { _key?: string };
export interface BrainSection {
  key: string;
  label: string;
  help: string;
  /** One record (Overview) or a list of items. */
  single?: boolean;
  fields: BrainField[];
  /** What the AI should look for when filling this section. */
  aiAsk: string;
}

const ROLE_OPTIONS = [
  { value: "decision_maker", label: "Decision maker" },
  { value: "budget_owner", label: "Budget owner" },
  { value: "champion", label: "Champion" },
  { value: "influencer", label: "Influencer" },
];

export const BRAIN_SECTIONS: BrainSection[] = [
  {
    key: "overview", label: "Overview", single: true, help: "Who this account is and how it wants to sound. Used in every email and brief.",
    aiAsk: "the company's one-paragraph summary, its positioning (why it wins), HQ city and country, founding year, and 3 tone rules for its outreach",
    fields: [
      { key: "name", label: "Account name", kind: "text", need: "research" },
      { key: "website", label: "Website", kind: "text", placeholder: "https://example.com", need: "research" },
      { key: "hq", label: "Headquarters", kind: "text", placeholder: "City, Country" },
      { key: "summary", label: "What they do", kind: "long", need: "research" },
      { key: "positioning", label: "Value proposition and differentiators", kind: "long", need: "email" },
      { key: "tone", label: "Tone rules", kind: "lines", hint: "One rule per line", need: "email" },
      { key: "cta", label: "Call to action in emails", kind: "text", placeholder: "Worth a 20-minute call next week?", need: "email" },
      { key: "defaultMessage", label: "Default one-line pitch", kind: "long", need: "email" },
    ],
  },
  {
    key: "targeting", label: "Targeting rule", single: true, help: "Where and how big. Countries and minimum size are hard limits: companies outside them are never researched or contacted.",
    aiAsk: "the countries this company sells into (2-letter codes) and the typical employee size of its customers. Do not estimate IT or technology spend",
    fields: [
      { key: "countries", label: "Target countries", kind: "list", placeholder: "IN, AE", hint: "2-letter codes, separated by commas", need: "research" },
      { key: "secondaryCountries", label: "Also open to", kind: "list", placeholder: "SG, GB", hint: "Researched too, scored a little lower" },
      { key: "minEmployees", label: "Minimum employees (hard limit)", kind: "number", hint: "Smaller companies are never researched", need: "research" },
      { key: "midEmployees", label: "Mid-size from", kind: "number", hint: "Scoring only" },
      { key: "sweetSpot", label: "Best fit from", kind: "number", hint: "Scoring only: companies this big score highest" },
    ],
  },
  {
    key: "industries", label: "Industries", help: "Where this account wins. Match words are how the app recognises a company's industry.",
    aiAsk: "the industries this company sells into, each with 3-5 words that identify a company in that industry",
    fields: [
      { key: "label", label: "Industry", kind: "text", need: "research" },
      { key: "tier", label: "Priority", kind: "select", options: [{ value: "primary", label: "Primary" }, { value: "secondary", label: "Secondary" }] },
      { key: "match", label: "Match words", kind: "list", need: "research" },
      { key: "useCases", label: "Use cases to lead with", kind: "list", hint: "Names from Use cases" },
    ],
  },
  {
    key: "products", label: "Offerings", help: "The products or services this account sells.",
    aiAsk: "the company's products or service lines, each with one sentence on what it does",
    fields: [{ key: "name", label: "Offering", kind: "text" }, { key: "what", label: "What it does", kind: "long" }],
  },
  {
    key: "useCases", label: "Use cases", help: "The 3–4 proven problems this account solves. Emails lead with one of these.",
    aiAsk: "3-4 proven use cases: the problem (pains) a buyer has and the outcome the company delivers",
    fields: [{ key: "name", label: "Use case", kind: "text", need: "research" }, { key: "pains", label: "The buyer's pain", kind: "long" }, { key: "outcome", label: "The outcome delivered", kind: "long" }],
  },
  {
    key: "customers", label: "Case studies", help: "Past wins. Only public references are named in emails.",
    aiAsk: "named customers or case studies with a one-paragraph story of the result",
    fields: [{ key: "name", label: "Customer", kind: "text" }, { key: "story", label: "What was delivered and the result", kind: "long" }, { key: "publicReference", label: "Can be named publicly", kind: "bool" }],
  },
  {
    key: "proofPoints", label: "Proof points", help: "Facts and numbers that back up claims, each with where it comes from.",
    aiAsk: "concrete proof points (numbers, awards, certifications) with the page they come from",
    fields: [{ key: "text", label: "Proof point", kind: "long" }, { key: "source", label: "Source", kind: "text", placeholder: "Link or document name" }],
  },
  {
    key: "competitors", label: "Competitors", help: "Who buyers compare this account with, and the angle that wins against each.",
    aiAsk: "direct competitors, each with its category and the angle this company should take against it",
    fields: [{ key: "name", label: "Competitor", kind: "text" }, { key: "category", label: "Category", kind: "text" }, { key: "angle", label: "How we win", kind: "long" }],
  },
  {
    key: "personas", label: "Decision makers", help: "The buying group: who decides, who pays, who uses. Messaging changes by role.",
    aiAsk: "the roles in the buying group (decision maker, budget owner, champion, influencer) with typical job titles, functions and why each one cares",
    fields: [
      { key: "role", label: "Role in the deal", kind: "select", options: ROLE_OPTIONS },
      { key: "titles", label: "Job titles", kind: "list", need: "research" },
      { key: "functions", label: "Functions", kind: "list", placeholder: "finance, it, operations" },
      { key: "why", label: "What they care about", kind: "long" },
    ],
  },
  {
    key: "triggers", label: "Buying triggers", help: "Events that make a company ready to buy now. The research looks for these words.",
    aiAsk: "events that make a company likely to buy now (expansion, new leader, funding, migration...), each with search keywords and why it matters",
    fields: [{ key: "label", label: "Trigger", kind: "text", need: "research" }, { key: "keywords", label: "Search keywords", kind: "list", need: "research" }, { key: "why", label: "Why it matters", kind: "long" }],
  },
  {
    key: "negativeSignals", label: "Red flags", help: "News that means: do not contact now.",
    aiAsk: "events that mean a company should not be contacted now (layoffs, freeze, signed a competitor)",
    fields: [{ key: "text", label: "Red flag", kind: "text" }],
  },
];

export const sectionByKey = (k: string) => BRAIN_SECTIONS.find((s) => s.key === k);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "item";
const strs = (v: unknown, sep: string | RegExp = ",") => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : typeof v === "string" ? v.split(sep).map((x) => x.trim()).filter(Boolean) : []);
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const n = (v: unknown, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Math.round(Number(v)) : d);

/** A brain for a brand-new account: the structure, nothing filled in. */
export function starterPack(id: string, name: string): SellerProfile {
  return {
    id, name, website: "", hq: "", founded: new Date().getFullYear(), summary: "", positioning: "",
    products: [], useCases: [], proofPoints: [], customers: [], competitors: [],
    icp: {
      industries: [], employees: { sweetSpot: 1000, mid: 500, min: 100 }, geos: { primary: [], secondary: [] },
      tech: { erp: [], incumbents: [], workflow: [] }, weights: { industry: 30, size: 25, geography: 20, partnerNetwork: 10, techStack: 15 },
    },
    personas: [], triggers: [], negativeSignals: [],
    researchQuestions: [
      { key: "trigger", label: "Recent trigger", trigger: true, question: `What changed recently that creates a need for what ${name} offers?`, importance: "high" },
      { key: "owner_function", label: "Who owns the problem", question: `Which function owns the problem ${name} solves?`, importance: "high" },
      { key: "negative", label: "Negative news", question: "Any layoffs, hiring freeze, insolvency, or a recently signed competing programme?", importance: "high" },
    ],
    messaging: { cta: "", byUseCase: {}, default: "" },
    sender: { company: name, name: `Team ${name}`, address: "" },
    tone: [], bannedClaims: ["guaranteed results or guaranteed ROI", "pricing or discounts"], autonomy: "review_all",
    ruleHints: { techHypothesis: "An existing {tech} setup can connect to what we offer", toolingPain: "Manual work across {tools}" },
  } as SellerProfile;
}

/** Section → editable items. */
export function readSection(p: SellerProfile, key: string): BrainItem[] {
  const ucName = new Map(p.useCases.map((u) => [u.key, u.name]));
  switch (key) {
    case "overview": return [{ name: p.name, website: p.website, hq: p.hq, summary: p.summary, positioning: p.positioning, tone: p.tone, cta: p.messaging.cta, defaultMessage: p.messaging.default }];
    case "targeting": return [{ countries: p.icp.geos.primary, secondaryCountries: p.icp.geos.secondary, minEmployees: p.icp.mustHave?.minEmployees ?? p.icp.employees.min, midEmployees: p.icp.employees.mid, sweetSpot: p.icp.employees.sweetSpot }];
    case "industries": return p.icp.industries.map((i) => ({ _key: i.key, label: i.label, tier: i.tier, match: i.match, useCases: i.useCases.map((k) => ucName.get(k) ?? k) }));
    case "products": return p.products.map((x) => ({ name: x.name, what: x.what }));
    case "useCases": return p.useCases.map((u) => ({ _key: u.key, name: u.name, pains: u.pains, outcome: u.outcome }));
    case "customers": return p.customers.map((c) => ({ name: c.name, story: c.story, publicReference: c.publicReference }));
    case "proofPoints": return p.proofPoints.map((x) => ({ text: x.text, source: x.source }));
    case "competitors": return p.competitors.map((c) => ({ name: c.name, category: c.category, angle: c.angle }));
    case "personas": return p.personas.map((x) => ({ role: x.role, titles: x.titles, functions: x.functions, why: x.why }));
    case "triggers": return p.triggers.map((t) => ({ _key: t.key, label: t.label, keywords: t.keywords, why: t.why }));
    case "negativeSignals": return p.negativeSignals.map((text) => ({ text }));
  }
  return [];
}

const uniqueKey = (base: string, used: Set<string>) => {
  let k = slug(base), i = 2;
  while (used.has(k)) k = `${slug(base)}_${i++}`;
  used.add(k);
  return k;
};

/** Items → pack. Keeps fields the editor doesn't show (by key), and drops references to removed use cases. */
/** The hard rule research applies: any target or "also open to" country, at least this many employees. */
export function targetingRule(geos: { primary: string[]; secondary: string[] }, minEmployees?: number): SellerProfile["icp"]["mustHave"] {
  const countries = [...new Set([...geos.primary, ...geos.secondary])];
  const min = minEmployees && minEmployees > 0 ? Math.round(minEmployees) : undefined;
  return countries.length || min ? { ...(countries.length ? { countries } : {}), ...(min ? { minEmployees: min } : {}) } : undefined;
}

export function writeSection(p: SellerProfile, key: string, items: BrainItem[]): SellerProfile {
  const next: SellerProfile = structuredClone(p);
  const rows = items.filter((it) => Object.entries(it).some(([k, v]) => k !== "_key" && (Array.isArray(v) ? v.length : s(v) !== "")));
  const one = rows[0] ?? {};
  switch (key) {
    case "overview":
      Object.assign(next, { name: s(one.name), website: s(one.website), hq: s(one.hq), summary: s(one.summary), positioning: s(one.positioning), tone: strs(one.tone, /\n/) });
      next.messaging = { ...next.messaging, cta: s(one.cta), default: s(one.defaultMessage) };
      next.sender = { ...next.sender, company: s(one.name) || next.sender.company };
      break;
    case "targeting":
      next.icp.geos = { primary: strs(one.countries).map((c) => c.toUpperCase()), secondary: strs(one.secondaryCountries).map((c) => c.toUpperCase()) };
      next.icp.employees = { min: n(one.minEmployees, p.icp.employees.min), mid: n(one.midEmployees, p.icp.employees.mid), sweetSpot: n(one.sweetSpot, p.icp.employees.sweetSpot) };
      // The hard gate reads mustHave: keep it in step with what people edit here.
      next.icp.mustHave = targetingRule(next.icp.geos, one.minEmployees == null || one.minEmployees === "" ? undefined : next.icp.employees.min);
      break;
    case "industries": {
      const byName = new Map(next.useCases.map((u) => [u.name.toLowerCase(), u.key]));
      const old = new Map(p.icp.industries.map((i) => [i.key, i]));
      const used = new Set<string>();
      next.icp.industries = rows.map((r) => {
        const prev = r._key ? old.get(r._key) : undefined;
        const k = prev ? (used.add(prev.key), prev.key) : uniqueKey(s(r.label), used);
        return { key: k, label: s(r.label), tier: r.tier === "secondary" ? "secondary" : "primary", match: strs(r.match).map((m) => m.toLowerCase()), partnerIntensity: prev?.partnerIntensity ?? 0.5, useCases: strs(r.useCases).map((x) => byName.get(x.toLowerCase()) ?? slug(x)) };
      });
      break;
    }
    case "products": next.products = rows.map((r) => ({ name: s(r.name), what: s(r.what) })); break;
    case "useCases": {
      const used = new Set<string>();
      next.useCases = rows.map((r) => ({ key: r._key && !used.has(r._key) ? (used.add(r._key), r._key) : uniqueKey(s(r.name), used), name: s(r.name), pains: s(r.pains), outcome: s(r.outcome) }));
      break;
    }
    case "customers": next.customers = rows.map((r) => ({ name: s(r.name), story: s(r.story), publicReference: r.publicReference === true || r.publicReference === "true" })); break;
    case "proofPoints": next.proofPoints = rows.map((r) => ({ text: s(r.text), source: s(r.source) })); break;
    case "competitors": next.competitors = rows.map((r) => ({ name: s(r.name), category: s(r.category), angle: s(r.angle) })); break;
    case "personas": next.personas = rows.map((r) => ({ role: (ROLE_OPTIONS.some((o) => o.value === r.role) ? r.role : "decision_maker") as SellerProfile["personas"][number]["role"], titles: strs(r.titles), functions: strs(r.functions).map((f) => f.toLowerCase()), why: s(r.why) })); break;
    case "triggers": {
      const old = new Map(p.triggers.map((t) => [t.key, t]));
      const used = new Set<string>();
      next.triggers = rows.map((r) => {
        const prev = r._key ? old.get(r._key) : undefined;
        const k = prev ? (used.add(prev.key), prev.key) : uniqueKey(s(r.label), used);
        return { ...(prev ?? {}), key: k, label: s(r.label), keywords: strs(r.keywords), why: s(r.why) };
      });
      break;
    }
    case "negativeSignals": next.negativeSignals = rows.map((r) => s(r.text)).filter(Boolean); break;
  }
  // Drop references to use cases that no longer exist.
  const keys = new Set(next.useCases.map((u) => u.key));
  for (const i of next.icp.industries) i.useCases = i.useCases.filter((k) => keys.has(k));
  for (const t of next.triggers) if (t.useCase && !keys.has(t.useCase)) delete t.useCase;
  next.messaging.byUseCase = Object.fromEntries(Object.entries(next.messaging.byUseCase).filter(([k]) => keys.has(k)));
  if (next.writing) for (const e of next.writing.examples) if (e.useCase && !keys.has(e.useCase)) delete e.useCase;
  return next;
}

/** Plain-words checklist of what a brain still needs before research can run. */
export function readiness(p: SellerProfile): { ready: boolean; missing: string[] } {
  const problems = validatePack(p);
  if (!problems.length) return { ready: true, missing: [] };
  const words: [RegExp, string][] = [
    [/^website/, "Overview: a website starting with https://"], [/^name/, "Overview: the account name"], [/^hq/, "Overview: headquarters"],
    [/^summary/, "Overview: what they do"], [/^positioning/, "Overview: value proposition"], [/^tone/, "Overview: at least one tone rule"],
    [/^messaging\.cta/, "Overview: a call to action"], [/^messaging\.default/, "Overview: a default one-line pitch"],
    [/^useCases/, "Use cases: at least one"], [/^icp\.industries/, "Industries: at least one, with match words"],
    [/^icp\.geos/, "Targeting rule: at least one target country"], [/^personas/, "Decision makers: at least one, with job titles"],
    [/^triggers/, "Buying triggers: at least one, with keywords"], [/^sender/, "Sender details"],
  ];
  const out = new Set<string>();
  for (const pr of problems) out.add(words.find(([re]) => re.test(pr))?.[1] ?? pr);
  return { ready: false, missing: [...out] };
}

/** The brain to edit: the newest saved version (complete or not), else the built-in pack, else a blank one. */
export async function loadBrain(clientId: string): Promise<{ pack: SellerProfile; savedAt: Date | null; versions: number }> {
  const [latest, versions, client] = await Promise.all([
    db.sellerPackRevision.findFirst({ where: { sellerId: clientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    db.sellerPackRevision.count({ where: { sellerId: clientId } }),
    db.client.findUnique({ where: { id: clientId } }),
  ]);
  const pack = (latest?.pack as SellerProfile | null) ?? builtInPack(clientId) ?? starterPack(clientId, client?.name ?? clientId);
  return { pack, savedAt: latest?.createdAt ?? null, versions };
}

/** Save one section as a new version. Incomplete brains are saved too (runs ignore them until complete). */
export async function saveBrain(clientId: string, pack: SellerProfile, note: string): Promise<{ ok: true; ready: boolean } | { ok: false; message: string }> {
  const { pack: current } = await loadBrain(clientId);
  if (!changedSections(current, pack).length) return { ok: false, message: "Nothing changed" };
  await db.sellerPackRevision.create({
    data: { sellerId: clientId, pack: pack as unknown as Prisma.InputJsonValue, version: hashPack(pack), changed: changedSections(current, pack), note: note.slice(0, 500) },
  });
  await ensureSellerPacks();
  return { ok: true, ready: readiness(pack).ready };
}
