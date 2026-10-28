// Contracts for the research engine's AI roles: investigator, connector, validator and the
// whole-email auditor. Every output is schema-checked; code then applies its own guards.

import { z } from "zod";

/** What a development can be called, from weakest to strongest claim. */
export const CLASSIFICATIONS = ["irrelevant", "inconclusive", "verified_event", "relevant_development", "supported_opportunity", "direct_intent"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASS_RANK: Record<Classification, number> = Object.fromEntries(CLASSIFICATIONS.map((c, i) => [c, i])) as Record<Classification, number>;

export const CLASS_LABEL: Record<Classification, string> = {
  irrelevant: "Irrelevant",
  inconclusive: "Inconclusive",
  verified_event: "Verified event",
  relevant_development: "Relevant development",
  supported_opportunity: "Supported opportunity",
  direct_intent: "Direct buying intent",
};

/** The sentence each class allows us to say. */
export const CLASS_CLAIM: Record<Classification, string> = {
  irrelevant: "Not an intent signal.",
  inconclusive: "No defensible conclusion yet.",
  verified_event: "The company announced X.",
  relevant_development: "X may be relevant to Y.",
  supported_opportunity: "Evidence suggests a potential need for Y.",
  direct_intent: "The company is evaluating / procuring Y (stated by the source).",
};

export const PURPOSES = ["baseline", "confirm", "disconfirm", "connect", "discover"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const RELATIONS = ["announced_by", "part_of", "responsible_for", "may_create_need_for", "contradicts", "supported_by", "same_programme", "same_owner", "same_timeframe"] as const;

/** offering → problem → observable conditions → use case → buyer → disconfirming evidence. */
export interface RelevanceMap {
  client: string;
  version: string;
  offerings: { name: string; what: string; useCases: string[] }[];
  useCases: { key: string; problem: string; outcome: string; observable: string[]; buyers: string[]; disconfirming: string[] }[];
  disqualifiers: string[];
}

export interface InvestigationFact {
  id: string;
  key: string;
  claim: string;
  quote: string | null;
  publisher: string | null;
  publishedAt: string;
  status: string;
  negative: boolean;
}

export interface InvestigationHypothesis {
  id: string;
  text: string;
  classification: string;
  status: string;
  useCase: string | null;
  supportIds: string[];
  counterIds: string[];
  assumptions: string[];
}

export interface InvestigateInput {
  company: { name: string; domain: string | null; industry: string | null; employees: number | null; country: string | null };
  relevance: RelevanceMap;
  facts: InvestigationFact[];
  hypotheses: InvestigationHypothesis[];
  asked: string[];
  round: number;
  maxQuestions: number;
}

export const investigateSchema = z.object({
  hypotheses: z.array(z.object({
    ref: z.string(), // an existing hypothesis id, or "new"
    text: z.string().min(8).max(400),
    useCase: z.string().nullable().optional(),
    assumptions: z.array(z.string().max(240)).max(5).default([]),
    supportIds: z.array(z.string()).max(10).default([]),
    counterIds: z.array(z.string()).max(10).default([]),
  })).max(6),
  questions: z.array(z.object({
    question: z.string().min(8).max(300),
    query: z.string().min(4).max(240),
    purpose: z.enum(PURPOSES),
    hypothesisRef: z.string().nullable().optional(),
    value: z.number().min(1).max(5),
    why: z.string().max(300),
  })).max(8),
  done: z.boolean(),
  doneWhy: z.string().max(300).default(""),
});
export type InvestigateOutput = z.infer<typeof investigateSchema>;

export interface ConnectInput {
  company: { name: string; domain: string | null };
  relevance: RelevanceMap;
  facts: InvestigationFact[];
  hypotheses: InvestigationHypothesis[];
}

export const connectSchema = z.object({
  hypotheses: z.array(z.object({
    id: z.string(),
    classification: z.enum(CLASSIFICATIONS),
    useCase: z.string().nullable().optional(),
    rationale: z.string().max(500),
    supportIds: z.array(z.string()).max(12).default([]),
    counterIds: z.array(z.string()).max(12).default([]),
    alternatives: z.array(z.string().max(240)).max(4).default([]),
  })),
  links: z.array(z.object({
    hypothesisId: z.string().nullable().optional(),
    from: z.string(), // fact:<id> | capability:<useCase> | hypothesis:<id> | entity:<name>
    relation: z.enum(RELATIONS),
    to: z.string(),
    rationale: z.string().max(300),
    evidenceIds: z.array(z.string()).max(8).default([]),
  })).max(30),
});
export type ConnectOutput = z.infer<typeof connectSchema>;

export interface ValidateInput {
  company: { name: string; domain: string | null };
  today: string;
  hypotheses: {
    id: string;
    text: string;
    classification: string;
    rationale: string | null;
    support: { id: string; claim: string; quote: string | null; passage: string | null; publisher: string | null; publishedAt: string; fingerprint: string | null }[];
    counter: { id: string; claim: string; quote: string | null }[];
    links: { from: string; relation: string; to: string; rationale: string; evidenceIds: string[] }[];
  }[];
}

export const validateSchema = z.object({
  results: z.array(z.object({
    hypothesisId: z.string(),
    verdict: z.enum(["upheld", "downgrade", "reject", "needs_research"]),
    classification: z.enum(CLASSIFICATIONS),
    issues: z.array(z.string().max(300)).max(6).default([]),
    alternatives: z.array(z.string().max(240)).max(4).default([]),
    repairQuestions: z.array(z.object({ question: z.string().max(300), query: z.string().max(240) })).max(3).default([]),
  })),
});
export type ValidateOutput = z.infer<typeof validateSchema>;

export interface EmailAuditInput {
  company: string;
  body: string;
  facts: { id: string; claim: string; quote: string | null }[];
  hypotheses: string[];
}

export const emailAuditSchema = z.object({
  sentences: z.array(z.object({
    text: z.string(),
    aboutProspect: z.boolean(),
    kind: z.enum(["fact", "hypothesis", "seller", "other"]),
    supported: z.boolean(),
    factIds: z.array(z.string()).default([]),
    phrasedAsHypothesis: z.boolean().default(false),
    reason: z.string().max(240).default(""),
  })).max(40),
});
export type EmailAuditOutput = z.infer<typeof emailAuditSchema>;
