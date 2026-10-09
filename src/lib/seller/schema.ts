// Pack schema: a seller pack must pass this before any run uses it. It covers every
// field, because packs can now be edited in Settings and saved to the database: a
// mistyped or missing field must be refused at save time, not crash a run later.

import { z } from "zod";
import type { SellerProfile } from "./types";
import { PLAYS, checkPlay, type PlayKey } from "@/lib/knowledge/playbook";
import { SOURCES } from "@/lib/knowledge/sources";

const str = z.string().trim().min(1);
const strList = z.array(str);
const key = z.string().regex(/^[a-z0-9_]+$/, "use lowercase letters, digits and _ only");
const country = z.string().regex(/^[A-Z]{2}$/, "use 2-letter country codes like IN, AE, US");
const role = z.enum(["decision_maker", "champion", "influencer", "budget_owner"]);
const playKey = z.enum(Object.keys(PLAYS) as [PlayKey, ...PlayKey[]]);

const writingSchema = z
  .object({
    market: z.object({ label: str, norms: z.array(z.object({ text: str, sources: z.array(z.string()) }).strict()) }).strict(),
    personas: z.array(z.object({ key, name: str, role, functions: strList, titleHints: strList, cares: strList.min(1), language: strList, avoid: strList, opener: str, sources: z.array(z.string()) }).strict()).min(1),
    marketFacts: z.array(z.object({ id: key, text: str, attribution: str, source: z.string() }).strict()),
    objections: z.array(z.object({ key, objection: str, answer: str, sources: z.array(z.string()) }).strict()),
    examples: z.array(z.object({ id: key, play: playKey, persona: key, useCase: key.optional(), trigger: key.optional(), quality: z.enum(["good", "bad"]), subject: str.optional(), body: str, why: str }).strict()),
  })
  .strict();

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
    writing: writingSchema.optional(),
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
  if (p.writing) out.push(...validateWriting(p));
  return out;
}

/** Cross-checks for the writing knowledge: references resolve, and every good example obeys its own play. */
function validateWriting(p: SellerProfile): string[] {
  const w = p.writing!;
  const out: string[] = [];
  const personaKeys = new Set(w.personas.map((x) => x.key));
  if (personaKeys.size !== w.personas.length) out.push("writing: persona keys must be unique");
  if (new Set(w.examples.map((x) => x.id)).size !== w.examples.length) out.push("writing: example ids must be unique");
  if (new Set(w.objections.map((x) => x.key)).size !== w.objections.length) out.push("writing: objection keys must be unique");
  const cited = [...w.market.norms.flatMap((n) => n.sources), ...w.personas.flatMap((x) => x.sources), ...w.objections.flatMap((o) => o.sources), ...w.marketFacts.map((f) => f.source)];
  for (const s of new Set(cited)) if (!SOURCES[s]) out.push(`writing: unknown source "${s}"`);
  const useCases = new Set(p.useCases.map((u) => u.key));
  const triggers = new Set(p.triggers.map((t) => t.key));
  for (const e of w.examples) {
    if (!personaKeys.has(e.persona)) out.push(`writing: example ${e.id} names unknown persona ${e.persona}`);
    if (e.useCase && !useCases.has(e.useCase)) out.push(`writing: example ${e.id} names unknown use case ${e.useCase}`);
    if (e.trigger && !triggers.has(e.trigger)) out.push(`writing: example ${e.id} names unknown trigger ${e.trigger}`);
    if (e.quality === "good") {
      const c = checkPlay(PLAYS[e.play], { subject: e.subject, body: e.body });
      if (!c.pass) out.push(`writing: example ${e.id} breaks its own play — ${c.issues[0]}`);
    }
  }
  return out;
}
