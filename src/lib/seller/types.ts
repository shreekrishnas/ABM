// Seller pack: everything about who the brain sells for. The core (research, judging,
// writing, learning) is generic; this is the only place seller-specific words live.
// Adding a seller = adding a pack file + passing tests/seller-pack.test.ts.

import type { PlayKey } from "@/lib/knowledge/playbook";

export type BuyingRoleKey = "decision_maker" | "champion" | "influencer" | "budget_owner";

/** A buyer the seller writes to, in more depth than `personas`: what they care about and how they talk. */
export interface PersonaProfile {
  key: string;
  name: string;
  role: BuyingRoleKey;
  functions: string[];
  /** Title words that identify this persona (lowercase). */
  titleHints: string[];
  /** What keeps them busy and what they are measured on. */
  cares: string[];
  /** Words and phrases they use for the problem. */
  language: string[];
  avoid: string[];
  /** The kind of opening that tends to land. */
  opener: string;
  sources: string[];
}

export interface WritingExample {
  id: string;
  play: PlayKey;
  /** PersonaProfile key. */
  persona: string;
  useCase?: string;
  trigger?: string;
  /** good = imitate; bad = what to avoid. */
  quality: "good" | "bad";
  subject?: string;
  body: string;
  why: string;
}

/** Everything the writer knows about writing for this seller's market and buyers. */
export interface WritingKnowledge {
  market: { label: string; norms: { text: string; sources: string[] }[] };
  personas: PersonaProfile[];
  /** Third-party facts the writer may use (named source, never as a claim about the prospect). */
  marketFacts: { id: string; text: string; attribution: string; source: string }[];
  objections: { key: string; objection: string; answer: string; sources: string[] }[];
  examples: WritingExample[];
}

export interface SellerProfile {
  id: string;
  name: string;
  website: string;
  hq: string;
  founded: number;
  summary: string;
  positioning: string;
  products: { name: string; what: string }[];
  useCases: { key: string; name: string; pains: string; outcome: string }[];
  proofPoints: { text: string; source: string }[];
  customers: { name: string; story: string; publicReference: boolean }[];
  competitors: { name: string; category: string; angle: string }[];
  icp: {
    industries: { key: string; label: string; tier: "primary" | "secondary"; match: string[]; partnerIntensity: number; useCases: string[] }[];
    employees: { sweetSpot: number; mid: number; min: number };
    geos: { primary: string[]; secondary: string[] };
    tech: { erp: string[]; incumbents: string[]; workflow: string[] };
    weights: { industry: number; size: number; geography: number; partnerNetwork: number; techStack: number };
    /** Starting tier from employee count (T1 at or above T1, T2 at or above T2, else T3). Hot buying signals upgrade to T1. */
    tierBySize?: { T1: number; T2: number };
    /** "any" = no target industries: industry neither adds nor removes fit; the list below only helps pick use cases. */
    industryMode?: "targeted" | "any";
    /** Hard rules: a company that fails one is excluded before any research money is spent. */
    mustHave?: { countries?: string[]; minEmployees?: number };
  };
  personas: { role: BuyingRoleKey; functions: string[]; titles: string[]; why: string }[];
  triggers: { key: string; label: string; keywords: string[]; why: string }[];
  negativeSignals: string[];
  /** core = asked for every company; deep = the deep dive (T1, or anyone engaged on LinkedIn). */
  researchQuestions: ResearchQuestion[];
  messaging: { cta: string; byUseCase: Record<string, string>; default: string };
  sender: { company: string; name: string; address: string };
  /** How emails should sound — passed to the writer and the tone critic. */
  tone: string[];
  /** Claims the brain must never make for this seller (checked by code before any email is approved). */
  bannedClaims: string[];
  /** When a person must approve (code-enforced). review_all = every email; auto_t3 = T3 emails that pass every critic go out; auto_all = all passing emails go out. */
  autonomy: "review_all" | "auto_t3" | "auto_all";
  /** Wording for the rule-based fallback brain; {tech} and {tools} are filled in. */
  ruleHints: { techHypothesis: string; toolingPain: string };
  /** Writing knowledge base: personas, market norms, objections, examples. */
  writing?: WritingKnowledge;
}

export interface ResearchQuestion {
  key: string;
  /** Short name shown on screens. */
  label: string;
  question: string;
  importance: "high" | "medium" | "low";
  /** core = asked for every company; deep = the deep dive (T1, or anyone engaged on LinkedIn). */
  depth?: "core" | "deep";
  /** An answer opens the "why now" (counts as a buying trigger). */
  trigger?: boolean;
  /** Web search: terms after the quoted company name, how far back, news or general. */
  search?: { terms: string; days: number | null; news: boolean };
  /** What the extractor should pull from pages for this question. */
  extract?: string;
}
