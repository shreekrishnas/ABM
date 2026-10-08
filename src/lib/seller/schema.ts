// Pack schema: a seller pack must pass this before any run uses it.

import { z } from "zod";
import type { SellerProfile } from "./types";

const str = z.string().min(1);

export const packSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: str,
  summary: str,
  useCases: z.array(z.object({ key: str, name: str, pains: str, outcome: str })).min(1),
  proofPoints: z.array(z.object({ text: str, source: str })),
  icp: z.object({
    industries: z.array(z.object({ key: str, label: str, tier: z.enum(["primary", "secondary"]), match: z.array(str).min(1), partnerIntensity: z.number().min(0).max(1), useCases: z.array(str) })).min(1),
    employees: z.object({ sweetSpot: z.number(), mid: z.number(), min: z.number() }),
    geos: z.object({ primary: z.array(str).min(1), secondary: z.array(str) }),
    weights: z.object({ industry: z.number(), size: z.number(), geography: z.number(), partnerNetwork: z.number(), techStack: z.number() }),
  }),
  personas: z.array(z.object({ role: z.enum(["decision_maker", "champion", "influencer", "budget_owner"]), titles: z.array(str).min(1), why: str })).min(1),
  triggers: z.array(z.object({ key: str, label: str, keywords: z.array(str).min(1), why: str })).min(1),
  researchQuestions: z
    .array(z.object({ key: z.string().regex(/^[a-z_]+$/), label: str, question: str, importance: z.enum(["high", "medium", "low"]), depth: z.enum(["core", "deep"]).optional(), trigger: z.boolean().optional() }))
    .min(3),
  messaging: z.object({ cta: str, byUseCase: z.record(z.string(), str), default: str }),
  sender: z.object({ company: str, name: str, address: str }),
  tone: z.array(str).min(1),
  bannedClaims: z.array(str),
  autonomy: z.enum(["review_all", "auto_t3", "auto_all"]),
  ruleHints: z.object({ techHypothesis: z.string().includes("{tech}"), toolingPain: z.string().includes("{tools}") }),
});

/** Problems with a pack; empty = valid. Also checks the cross-references a schema can't. */
export function validatePack(p: SellerProfile): string[] {
  const r = packSchema.safeParse(p);
  const out = r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const keys = new Set(p.useCases.map((u) => u.key));
  for (const ind of p.icp.industries) for (const u of ind.useCases) if (!keys.has(u)) out.push(`industry ${ind.key} names unknown use case ${u}`);
  for (const k of Object.keys(p.messaging.byUseCase)) if (!keys.has(k)) out.push(`messaging names unknown use case ${k}`);
  const q = p.researchQuestions.map((x) => x.key);
  for (const required of ["trigger", "negative", "owner_function"]) if (!q.includes(required)) out.push(`research question "${required}" is required`);
  if (new Set(q).size !== q.length) out.push("research question keys must be unique");
  return out;
}
