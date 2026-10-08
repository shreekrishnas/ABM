import type { Stage } from "@/lib/journey/stages";
import type { AccountBriefData, BrainStats, BriefInput, ClaimToCheck, InsightSummary, PlanResearchInput, PlanResearchOutput } from "@/lib/brain/types";

// Interfaces for every external system. Stages depend on these, never on a vendor.
// Swap the mock implementations for real ones in adapters/index.ts.

export interface ProviderPerson {
  fullName: string;
  title: string | null;
  companyDomain: string | null;
  email: string | null;
  linkedinUrl: string | null;
  observedAt: Date;
  source: string;
}

/** Match hints, as accepted by people-match APIs (name + domain, optionally email/title). */
export interface PersonQuery {
  fullName: string;
  domain: string;
  email?: string | null;
  title?: string | null;
}

export interface DataProvider {
  name: string;
  /** Current role and employer for a person. LinkedIn is matched, never scraped. */
  lookupPerson(q: PersonQuery): Promise<ProviderPerson | null>;
  /** Second, independent source used once for a focused re-check. */
  recheckPerson(q: PersonQuery): Promise<ProviderPerson | null>;
  /** People at a domain within a function (for missing buying roles). */
  findByFunction(domain: string, fn: string, limit: number): Promise<ProviderPerson[]>;
  /** Paid email lookup. */
  findEmail(fullName: string, domain: string): Promise<string | null>;
}

export interface MailboxVerifier {
  verify(email: string): Promise<{ deliverable: boolean; reason: string; status?: "verified" | "probable" | "invalid" }>;
}

export interface ResearchPage {
  url: string;
  sourceType: "official" | "press" | "news" | "careers" | "provider" | "review_site" | "mock";
  publishedAt: Date;
  title: string;
  text: string;
  /** Engine that returned the page (exa | tavily | serp | mock). */
  engine?: string;
}

export type ResearchPass = "main" | "followup" | "reopen" | "refresh";

export interface ResearchSource {
  /** True for real web search; the evidence gate then refuses mock evidence. */
  readonly live?: boolean;
  /** Engines this source can use, so the brain can route questions between them. */
  engines(): string[];
  /** The brain may give a tailored query and a preferred engine. */
  search(domain: string, companyName: string, questionKey: string, pass: ResearchPass, hint?: SearchHint): Promise<ResearchPage[]>;
}

export interface SearchHint {
  query?: string;
  engine?: string;
  /** Called for every engine actually queried (each one costs credits). */
  onAttempt?: (a: { engine: string; results: number; error?: string }) => void;
}

export interface ExtractedEvidence {
  key: string;
  claim: string;
  value: string | null;
  sourceUrl: string;
  sourceType: string;
  publishedAt: Date;
  isNegative: boolean;
  negativeKind: string | null;
  /** Set when this page confirms a fact we already hold (independent corroboration). */
  sameAsFactId?: string | null;
  /** Exact sentence copied from the page that supports the claim. Code checks it is really on the page. */
  quote?: string | null;
}

export interface Inference {
  text: string;
  basedOn: string[]; // evidence ids
}

export interface DraftInput {
  firstName: string | null;
  title: string | null;
  company: string;
  stepOrder: number;
  instruction: string;
  facts: { id: string; key: string; claim: string }[];
  sender: { name: string; company: string; address: string };
  /** Approved seller collateral for this account's use case (not a claim about the prospect). */
  seller: { name: string; pitch: string; cta: string; useCase: string | null };
  /** The brain's angle for this person (from the account brief). */
  angle?: { pain: string; capability: string; persona: string; whyNow: string | null; proofPoint: string | null } | null;
  /** What has worked before, from the learning loop (advice, not facts). */
  learnings?: string[];
  /** Seller pack voice and fences. */
  tone?: string[];
  bannedClaims?: string[];
  /** Rewriter: the previous version and what the critic panel found wrong with it. */
  revise?: { subject: string; body: string; issues: string[] } | null;
}

export interface CritiqueInput {
  subject: string;
  body: string;
  company: string;
  recipientTitle: string | null;
  angle: string | null;
  tone: string[];
  bannedClaims: string[];
}
export interface CritiqueOutput {
  pass: boolean;
  /** Each issue is specific enough for the rewriter to fix. */
  issues: string[];
  /** Short case for sending this version as it stands. */
  strengths: string[];
}

export interface DraftOutput {
  subject: string;
  body: string;
  angle: string | null;
  claims: { text: string; factIds: string[] }[];
}

export interface BriefingInput {
  company: string;
  facts: { id: string; claim: string }[];
  unknowns: string[];
  engaged: { name: string; title: string | null; signals: string[] }[];
  trigger: string;
}

export interface BriefingOutput {
  whyNow: string;
  facts: { text: string; factId: string }[];
  unknowns: string[];
  engaged: { name: string; title: string | null; signals: string[] }[];
}

export type ModelTier = "cheap" | "strong";

export interface LLM {
  /** "mock" or the model id — recorded on everything the brain produces. */
  readonly model: string;
  extractEvidence(pages: ResearchPage[], questionKey: string, known?: { id: string; claim: string }[]): Promise<ExtractedEvidence[]>;
  infer(facts: { id: string; key: string; claim: string }[]): Promise<Inference[]>;
  mapRole(title: string | null, ownerFunction: string | null, contactFunction: string | null): Promise<"decision_maker" | "champion" | "influencer" | "budget_owner" | "unknown">;
  draft(input: DraftInput, attempt: number): Promise<DraftOutput>;
  classifyReply(text: string): Promise<"positive" | "objection" | "not_now" | "unsubscribe" | "wrong_person" | "out_of_office" | "needs_human">;
  briefing(input: BriefingInput): Promise<BriefingOutput>;
  // ── The brain ──
  planResearch(input: PlanResearchInput): Promise<PlanResearchOutput>;
  accountBrief(input: BriefInput): Promise<AccountBriefData>;
  /** Style and relevance critic: tone, banned claims, relevance to the angle and role. */
  critiqueDraft(input: CritiqueInput): Promise<CritiqueOutput>;
  checkClaims(claims: ClaimToCheck[]): Promise<{ index: number; supported: boolean; reason: string }[]>;
  insights(stats: BrainStats): Promise<InsightSummary>;
  /** Industry, employee count and country from company pages; `page` = index of the page it came from. */
  extractFirmographics(pages: ResearchPage[], company: string): Promise<{ industry: string | null; employees: number | null; country: string | null; page: number } | null>;
  /** Meaning of a LinkedIn/email reply as one of the 17 People stages (a suggestion a person confirms). */
  classifyJourneyReply(text: string, context: { company: string; title: string | null; stage: string }): Promise<{ stage: Stage; reason: string; nextAction: string }>;
}

export interface EmailSender {
  /** false = no real mailbox; the sender holds approved emails instead of sending. Mocks leave it undefined. */
  readonly connected?: boolean;
  send(msg: { from: string; to: string; subject: string; body: string; idempotencyKey: string }): Promise<{ providerId: string }>;
}

export interface IntentProvider {
  /** 0–100 topic intent for a domain, plus the topics surging. */
  intent(domain: string): Promise<{ score: number; topics: string[] }>;
}

export interface Notifier {
  alert(to: string, subject: string, body: string): Promise<void>;
}

export interface Adapters {
  provider: DataProvider;
  mailbox: MailboxVerifier;
  research: ResearchSource;
  llm: LLM;
  email: EmailSender;
  intent: IntentProvider;
  notifier: Notifier;
}
