// Pack schema: a seller pack must pass this before any run uses it. It covers every
// field, because packs can now be edited in Settings and saved to the database: a
// mistyped or missing field must be refused at save time, not crash a run later.

import { z } from "zod";
import type { SellerProfile } from "./types";

const str = z.string().trim().min(1);
const strList = z.array(str);
const key = z.string().regex(/^[a-z0-9_]+$/, "use lowercase letters, digits and _ only");
const country = z.string().regex(/^[A-Z]{2}$/, "use 2-letter country codes like IN, AE, US");

export const packSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: str,
    website: z.string().url(),
    hq: str,
    founded: z.number().int().min(1800).max(2100),
    summary: str,
    positioning: str,
    products: z.array(z.object({ name: str, what: str }).strict()),
    useCases: z.array(z.object({ key, name: str, pains: str, outcome: str }).strict()).min(1),
    proofPoints: z.array(z.object({ text: str, source: str }).strict()),
    customers: z.array(z.object({ name: str, story: str, publicReference: z.boolean() }).strict()),
    competitors: z.array(z.object({ name: str, category: str, angle: str }).strict()),
    icp: z
      .object({
        industries: z.array(z.object({ key, label: str, tier: z.enum(["primary", "secondary"]), match: strList.min(1), partnerIntensity: z.number().min(0).max(1), useCases: strList }).strict()).min(1),
        employees: z.object({ sweetSpot: z.number().int().min(0), mid: z.number().int().min(0), min: z.number().int().min(0) }).strict(),
        geos: z.object({ primary: z.array(country).min(1), secondary: z.array(country) }).strict(),
        tech: z.object({ erp: strList, incumbents: strList, workflow: strList }).strict(),
        weights: z.object({ industry: z.number().min(0), size: z.number().min(0), geography: z.number().min(0), partnerNetwork: z.number().min(0), techStack: z.number().min(0) }).strict(),
        tierBySize: z.object({ T1: z.number().int().min(1), T2: z.number().int().min(1) }).strict().optional(),
        industryMode: z.enum(["targeted", "any"]).optional(),
        mustHave: z.object({ countries: z.array(country).min(1).optional(), minEmployees: z.number().int().min(1).optional() }).strict().optional(),
      })
      .strict(),
    personas: z.array(z.object({ role: z.enum(["decision_maker", "champion", "influencer", "budget_owner"]), functions: strList, titles: strList.min(1), why: str }).strict()).min(1),
    triggers: z.array(z.object({ key, label: str, keywords: strList.min(1), why: str }).strict()).min(1),
    negativeSignals: strList,
    researchQuestions: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z_]+$/),
            label: str,
            question: str,
            importance: z.enum(["high", "medium", "low"]),
            depth: z.enum(["core", "deep"]).optional(),
            trigger: z.boolean().optional(),
            search: z.object({ terms: str, days: z.number().int().min(1).nullable(), news: z.boolean() }).strict().optional(),
            extract: str.optional(),
          })
          .strict(),
      )
      .min(3),
    messaging: z.object({ cta: str, byUseCase: z.record(z.string(), str), default: str }).strict(),
    sender: z.object({ company: str, name: str, address: str }).strict(),
    tone: strList.min(1),
    bannedClaims: strList,
    autonomy: z.enum(["review_all", "auto_t3", "auto_all"]),
    ruleHints: z.object({ techHypothesis: z.string().includes("{tech}"), toolingPain: z.string().includes("{tools}") }).strict(),
  })
  .strict();

/** Problems with a pack; empty = valid. Also checks the cross-references a schema can't. */
export function validatePack(p: SellerProfile): string[] {
  const r = packSchema.safeParse(p);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join(".") || "pack"}: ${i.message}`);
  const out: string[] = [];
  const keys = new Set(p.useCases.map((u) => u.key));
  if (keys.size !== p.useCases.length) out.push("use case keys must be unique");
  for (const ind of p.icp.industries) for (const u of ind.useCases) if (!keys.has(u)) out.push(`industry ${ind.key} names unknown use case ${u}`);
  for (const k of Object.keys(p.messaging.byUseCase)) if (!keys.has(k)) out.push(`messaging names unknown use case ${k}`);
  const q = p.researchQuestions.map((x) => x.key);
  for (const required of ["trigger", "negative", "owner_function"]) if (!q.includes(required)) out.push(`research question "${required}" is required`);
  if (new Set(q).size !== q.length) out.push("research question keys must be unique");
  if (new Set(p.triggers.map((t) => t.key)).size !== p.triggers.length) out.push("trigger keys must be unique");
  if (p.icp.tierBySize && p.icp.tierBySize.T1 <= p.icp.tierBySize.T2) out.push("tier by size: the T1 threshold must be above T2");
  const e = p.icp.employees;
  if (!(e.sweetSpot >= e.mid && e.mid >= e.min)) out.push("company size: sweet spot ≥ mid ≥ minimum");
  if (Object.values(p.icp.weights).reduce((a, b) => a + b, 0) <= 0) out.push("fit weights must add up to more than 0");
  return out;
}
