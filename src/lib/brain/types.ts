// Contracts for the AI brain. The brain plans research, synthesises each account,
// picks a different angle per person, double-checks claims and learns from outcomes.
// Every output is validated in code: the model can suggest, never invent sources.

import { z } from "zod";
import type { BuyingRoleKey } from "@/lib/seller/types";

export interface CompanyCard {
  name: string;
  domain: string | null;
  industry: string | null;
  employees: number | null;
  country: string | null;
  technologies: string[];
  fitScore: number | null;
  fitReasons: string[];
}

// ── Research Director (stage 5) ──

/** What the CSV import brought in: used to steer research and the brief. */
export interface ImportedContext {
  technologies: string[];
  keywords: string[];
  notes: string | null;
  conversations: { name: string; title: string | null; stage: string; phrase?: string; lastReply: string | null; sender: string }[];
}

export interface PlanResearchInput {
  company: CompanyCard;
  imported?: ImportedContext;
  seller: { name: string; summary: string; useCases: { key: string; name: string; pains: string }[]; triggers: { key: string; label: string }[] };
  candidates: { key: string; question: string; importance: "high" | "medium" | "low" }[];
  known: { key: string; claim: string; status: string }[];
  /** Search engines with a key configured. */
  engines: string[];
  /** Best engine per question so far, learned from past yield (may be empty). */
  routing: Record<string, string>;
}

export const planResearchSchema = z.object({
  hypotheses: z.array(z.string().min(5).max(220)).max(4),
  questions: z.array(z.object({ key: z.string(), query: z.string().min(3).max(240), engine: z.string(), why: z.string().max(220) })).max(8),
  skip: z.array(z.object({ key: z.string(), reason: z.string().max(200) })).max(8).default([]),
});
export type PlanResearchOutput = z.infer<typeof planResearchSchema>;

// ── Strategist (stage 7) ──

export interface IntentContext {
  score: number;
  level: "hot" | "warm" | "cold";
  whyNow: string | null;
  /** Converging signals, strongest first, each specific (what, who, when). */
  signals: { family: string; label: string }[];
}

export interface BriefInput {
  company: CompanyCard;
  imported?: ImportedContext;
  intent?: IntentContext;
  facts: { id: string; key: string; claim: string; status: string; sourceType: string }[];
  inferences: string[];
  negatives: string[];
  unknowns: string[];
  hypotheses: string[];
  seller: {
    name: string;
    products: { name: string; what: string }[];
    useCases: { key: string; name: string; pains: string; outcome: string }[];
    personas: { role: BuyingRoleKey; titles: string[]; why: string }[];
    proofPoints: string[];
    competitors: { name: string; angle: string }[];
  };
  learnings: string[];
}

export const ROLES = ["decision_maker", "champion", "influencer", "budget_owner"] as const;

export const briefSchema = z.object({
  verdict: z.enum(["strong", "moderate", "weak"]),
  verdictWhy: z.string().min(5).max(400),
  whyNow: z.object({ text: z.string().min(5).max(300), factIds: z.array(z.string()).min(1) }).nullable(),
  painPoints: z
    .array(z.object({ pain: z.string().min(5).max(240), factIds: z.array(z.string()).min(1), useCase: z.string(), capability: z.string().max(200), confidence: z.enum(["high", "medium", "low"]) }))
    .max(5),
  personaAngles: z.array(z.object({ role: z.enum(ROLES), angle: z.string().min(5).max(240), painIndex: z.number().int().min(0) })).max(6),
  hypotheses: z.array(z.string().max(240)).max(5),
  risks: z.array(z.string().max(240)).max(5),
  nextBestAction: z.string().min(5).max(300),
});
export type AccountBriefData = z.infer<typeof briefSchema>;

// ── Claim checker (stage 11) ──

export interface ClaimToCheck {
  text: string;
  facts: { id: string; claim: string }[];
}
export const claimCheckSchema = z.object({ results: z.array(z.object({ index: z.number().int(), supported: z.boolean(), reason: z.string().max(240) })) });
export type ClaimCheckResult = { text: string; supported: boolean; reason: string };

// ── Learning loop ──

export interface Rate {
  label: string;
  n: number;
  hits: number;
  rate: number | null;
  /** Fewer examples than the sample threshold: a hint, not a finding. */
  tentative?: boolean;
}

export interface BrainStats {
  generatedAt: string;
  research: { engine: string; key: string; searches: number; cached: number; kept: number; costUsd: number; yield: number | null }[];
  creditsSavedUsd: number;
  messaging: { byUseCase: Rate[]; byRole: Rate[]; byTrigger: Rate[]; byTier: Rate[] };
  review: { reviewed: number; approvedAsIs: number; edited: number; rejected: number; guardrailBlocked: number; claimChecks: number; claimsUnsupported: number };
  facts: { total: number; flagged: number; byEngine: Rate[] };
  fit: Rate[];
  /** Reviewer verdicts (approved without edits) by use case and by how many rewrites the brain needed — arrives daily. */
  reviewer: { byUseCase: Rate[]; byRewrites: Rate[] };
  /** LinkedIn journeys that reached Interested or beyond, by sender and buying role. */
  linkedin: { bySender: Rate[]; byRole: Rate[] };
  /** Below this sample size a rate is not a finding. */
  minSample: number;
}

export const insightSchema = z.object({
  headline: z.string().min(5).max(300),
  working: z.array(z.object({ text: z.string().max(300), evidence: z.string().max(200) })).max(6),
  notWorking: z.array(z.object({ text: z.string().max(300), evidence: z.string().max(200) })).max(6),
  recommendations: z.array(z.object({ area: z.enum(["research", "messaging", "targeting", "process"]), text: z.string().max(300) })).max(8),
});
export type InsightSummary = z.infer<typeof insightSchema>;
