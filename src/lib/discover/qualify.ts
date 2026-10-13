// Every new-company source (market scan, lookalikes, website visitors) ends here: find the
// company's size, country and industry, check the seller's targeting rule, and save it as a
// suggestion a person approves. Nothing is researched or contacted before approval.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { mustHaveGate } from "@/lib/pipeline/gates";
import { companyNameKey, normalizeCountry, normalizeDomain } from "@/lib/pipeline/normalize";
import { apolloOrgEnrich } from "@/lib/adapters/live/apollo";
import type { RunContext } from "@/lib/pipeline/context";
import { bucketOf } from "./scan";

export type Origin = "market" | "lookalike" | "website_visitor";

export interface Candidate {
  name: string;
  domain?: string | null;
  industry?: string | null;
  employees?: number | null;
  country?: string | null;
}

export interface Firmo {
  industry: string | null;
  employees: number | null;
  country: string | null;
}

const apolloKey = () => (process.env.ADAPTER_MODE === "mock" ? undefined : process.env.APOLLO_API_KEY?.trim() || undefined);

/** Size, country and industry: what we were given, then Apollo, then a web search. */
export async function firmographicsFor(ctx: RunContext, c: Candidate): Promise<Firmo> {
  let f: Firmo = { industry: c.industry ?? null, employees: c.employees ?? null, country: normalizeCountry(c.country) };
  if (f.employees != null && f.country) return f;
  const key = apolloKey();
  const domain = normalizeDomain(c.domain);
  if (key && domain) {
    try {
      const o = await apolloOrgEnrich(key, domain);
      if (o) f = { industry: f.industry ?? o.industry, employees: f.employees ?? o.employees, country: f.country ?? normalizeCountry(o.country) };
      if (f.employees != null && f.country) return f;
    } catch {
      // fall through to web search
    }
  }
  try {
    const pages = await ctx.adapters.research.search(domain ?? "", c.name, "firmographics", "main");
    const x = await ctx.adapters.llm.extractFirmographics(pages, c.name);
    if (x) f = { industry: f.industry ?? x.industry, employees: f.employees ?? x.employees, country: f.country ?? normalizeCountry(x.country) };
  } catch {
    // unknown stays unknown; the gate says so
  }
  return f;
}

/** Companies already in the database (by website or name) are never suggested again. */
export async function heldKeys(): Promise<{ names: Set<string>; domains: Set<string> }> {
  const rows = await db.account.findMany({ select: { nameKey: true, domain: true } });
  return { names: new Set(rows.map((r) => r.nameKey).filter(Boolean) as string[]), domains: new Set(rows.map((r) => r.domain).filter(Boolean) as string[]) };
}

export interface SuggestionInput {
  origin: Origin;
  candidate: Candidate;
  firmo: Firmo;
  score: number;
  level: "hot" | "warm" | "cold";
  whyNow: string;
  families?: string[];
  sources?: { url: string; quote: string; at: string; trigger: string }[];
  seed?: string | null;
}

/** Save (or refresh) a suggestion. Approved and dismissed ones are left alone. */
export async function saveSuggestion(s: SuggestionInput): Promise<"new" | "excluded" | "kept" | null> {
  const p = seller();
  const nameKey = companyNameKey(s.candidate.name);
  if (!nameKey) return null;
  const prev = await db.prospectSuggestion.findUnique({ where: { sellerId_nameKey: { sellerId: p.id, nameKey } } });
  if (prev && (prev.status === "added" || prev.status === "dismissed")) return "kept";
  const gate = mustHaveGate({ country: s.firmo.country, employees: s.firmo.employees });
  const status = gate.pass || gate.unknown ? "new" : "excluded";
  const data = {
    origin: s.origin, seed: s.seed ?? null, name: s.candidate.name, domain: normalizeDomain(s.candidate.domain), industry: s.firmo.industry, bucket: bucketOf(s.firmo.industry),
    country: s.firmo.country, employees: s.firmo.employees, score: s.score, level: s.level, whyNow: s.whyNow.slice(0, 400), families: s.families ?? [],
    sources: (s.sources ?? []) as unknown as Prisma.InputJsonValue, status, reason: gate.pass ? null : gate.reason,
  };
  await db.prospectSuggestion.upsert({ where: { sellerId_nameKey: { sellerId: p.id, nameKey } }, create: { sellerId: p.id, nameKey, ...data }, update: data });
  return status;
}
