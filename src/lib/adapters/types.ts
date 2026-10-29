import type { ConnectInput, ConnectOutput, EmailAuditInput, EmailAuditOutput, InvestigateInput, InvestigateOutput, ValidateInput, ValidateOutput } from "@/lib/brain/research-types";
import type { Stage } from "@/lib/journey/stages";
import type { AccountBriefData, BrainStats, BriefInput, ClaimToCheck, InsightSummary, PlanResearchInput, PlanResearchOutput } from "@/lib/brain/types";
import type { WritingContext } from "@/lib/knowledge/select";

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
  /** True when `text` is the page read in full; false when it is only the search snippet. */
  full?: boolean;
  /** Site that published it (host) and when we read it. */
  publisher?: string;
  retrievedAt?: Date;
}

export type ResearchPass = "main" | "followup" | "reopen" | "refresh" | "investigate" | "repair";

export interface ResearchSource {
  /** True for real web search; the evidence gate then refuses mock evidence. */
  readonly live?: boolean;
  /** False when real research can't run (missing search or AI key): the run stops instead of using sample data. */
  readonly connected?: boolean;
  /** Engines this source can use, so the brain can route questions between them. */
  engines(): string[];
  /** The brain may give a tailored query and a preferred engine. */
  search(domain: string, companyName: string, questionKey: string, pass: ResearchPass, hint?: SearchHint): Promise<ResearchPage[]>;
  /** Companies whose websites resemble this one (Exa "find similar"); optional. */
  findSimilar?(url: string): Promise<ResearchPage[]>;
}

export interface SearchHint {
  query?: string;
  engine?: string;
  /** Called for every engine actually queried (each one costs credits). */
  onAttempt?: (a: { engine: string; results: number; error?: string }) => void;
  /** "all": ask every configured engine and merge (an empty answer from one engine is not proof). Default: stop at the first with results. */
  breadth?: "first" | "all";
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
  /** The person's strongest converging intent signals — choose the opening from these. Context, not claims. */
  signals?: string[];
  /** Topics they looked at on the seller's website — picks the angle; never mentioned in the message. */
  interest?: string | null;
  /** Rewriter: the previous version and what the critic panel found wrong with it. */
  revise?: { subject: string; body: string; issues: string[] } | null;
  /** email (default) or a LinkedIn message: no subject, no signature or unsubscribe footer. */
  channel?: "email" | "linkedin";
  /** Writing knowledge for this message: play, persona profile, examples, market norms and facts. */
  writing?: WritingContext;
}

export interface CritiqueInput {
  subject: string;
  body: string;
  company: string;
  recipientTitle: string | null;
  angle: string | null;
  tone: string[];
  bannedClaims: string[];
  /** The play the message was written to (plain-text brief), so style is judged against it. */
  play?: string;
  /** The recipient's persona profile name and what they care about. */
  persona?: string;
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
  extractEvidence(pages: ResearchPage[], questionKey: string, known?: { id: string; claim: string }[], guide?: { company: string; domain: string | null; question?: string }): Promise<ExtractedEvidence[]>;
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
  /** Market scan: companies named in news pages with a buying event. `quote` must be exact words from the page. */
  extractMarketEvents(pages: ResearchPage[]): Promise<MarketEventExtract[]>;
  /** Lookalikes: companies the pages name as similar to / competing with the seed. `quote` must be exact words from the page. */
  extractSimilarCompanies(pages: ResearchPage[], seed: { name: string; industry: string | null }): Promise<SimilarCompanyExtract[]>;
  /** Account Brain "AI fill": suggest items for one section from the account's pages and files. A person accepts or skips each. */
  suggestBrainItems(input: BrainSuggestInput): Promise<Record<string, string>[]>;
  /** Meaning of a LinkedIn/email reply as one of the 17 People stages (a suggestion a person confirms). */
  classifyJourneyReply(text: string, context: { company: string; title: string | null; stage: string }): Promise<{ stage: Stage; reason: string; nextAction: string }>;
  // ── Lookalikes ──
  /** What a company does and how it operates, from its own pages (quotes required). */
  profileCompany(pages: ResearchPage[], company: string, offering: string): Promise<LookalikeProfile | null>;
  /** The next questions worth asking about a candidate, given what is known. done = enough to judge. */
  planLookalike(input: LookalikePlanInput): Promise<{ questions: LookalikeQuestion[]; done: boolean; why: string }>;
  /** Facts about the candidate that answer one question, each with an exact quote. */
  extractLookalikeFacts(pages: ResearchPage[], company: string, question: LookalikeQuestion): Promise<LookalikeFact[]>;
  /** Fit per dimension, buying readiness and plain reasons, from the facts only. */
  judgeLookalike(input: LookalikeJudgeInput): Promise<LookalikeJudgement>;
  // ── The research engine ──
  /** Investigator: hypotheses and the next questions, ranked by how much the answer would change the conclusion. */
  investigate(input: InvestigateInput): Promise<InvestigateOutput>;
  /** Connector: classify each hypothesis honestly and link facts to each other and to the client's capabilities. */
  connectEvidence(input: ConnectInput): Promise<ConnectOutput>;
  /** Whole-email audit: every sentence about the prospect, not only the claims the writer listed. */
  auditEmail(input: EmailAuditInput): Promise<EmailAuditOutput>;
}

/** Independent validator: its own instructions, raw evidence, and optionally its own model (VALIDATOR_MODEL). */
export interface Validator {
  readonly model: string;
  validateResearch(input: ValidateInput): Promise<ValidateOutput>;
}

export interface MarketEventExtract {
  page: number;
  company: string;
  industry: string | null;
  /** Seller trigger key (e.g. erp_migration) or "other". */
  triggerKey: string;
  claim: string;
  quote: string;
}

export interface SimilarCompanyExtract {
  page: number;
  name: string;
  domain: string | null;
  /** Why it resembles the seed, in a few words (same industry, competitor, same customers…). */
  reason: string;
  quote: string;
}

export interface EmailSender {
  /** false = no real mailbox; the sender holds approved emails instead of sending. Mocks leave it undefined. */
  readonly connected?: boolean;
  send(msg: { from: string; to: string; subject: string; body: string; idempotencyKey: string }): Promise<{ providerId: string }>;
}

export interface IntentProvider {
  /** False when no real intent provider is connected: nothing reads or acts on its score. */
  readonly connected?: boolean;
  /** 0–100 topic intent for a domain, plus the topics surging. */
  intent(domain: string): Promise<{ score: number; topics: string[] }>;
}

export interface Notifier {
  alert(to: string, subject: string, body: string): Promise<void>;
}

/** Turns text into vectors for the knowledge base. Vectors from different models are never compared. */
export interface Embedder {
  /** Model id stored with every vector, e.g. "openai/text-embedding-3-small" or "hash-v1". */
  readonly model: string;
  readonly live: boolean;
  /** One vector per input, in order. Implementations batch internally. */
  embed(texts: string[]): Promise<number[][]>;
}

export interface Adapters {
  provider: DataProvider;
  mailbox: MailboxVerifier;
  research: ResearchSource;
  llm: LLM;
  email: EmailSender;
  intent: IntentProvider;
  notifier: Notifier;
  embedder: Embedder;
  validator: Validator;
}

export interface BrainSuggestInput {
  account: string;
  section: string;
  ask: string;
  fields: { key: string; label: string; kind: string; options?: string[] }[];
  /** What the brain already holds in this section, so suggestions add rather than repeat. */
  existing: string[];
  /** The account's website pages and uploaded files. */
  context: { title: string; url?: string | null; text: string }[];
  single: boolean;
}

// ── Lookalikes ──

export type LookalikeDimension = "business_model" | "operations" | "industry" | "scale" | "offering" | "intent";

export interface LookalikeProfile {
  summary: string;
  businessModel: string;
  operations: string;
  industry: string | null;
  customers: string;
  scale: string;
  /** Why this company buys (or would buy) what the client sells. */
  offeringFit: string;
}

export interface LookalikeQuestion {
  question: string;
  why: string;
  query: string;
  engine: "exa" | "tavily";
  dimension: LookalikeDimension;
}

export interface LookalikeFact {
  page: number;
  claim: string;
  quote: string;
  dimension: LookalikeDimension;
}

export interface LookalikeKnownFact {
  claim: string;
  dimension: LookalikeDimension;
  verified: boolean;
}

export interface LookalikePlanInput {
  seed: LookalikeProfile & { name: string };
  company: { name: string; domain: string | null };
  offering: string;
  focus: string[];
  avoid: string[];
  facts: LookalikeKnownFact[];
  asked: string[];
  /** A person's request ("Research more"): answered first. */
  note?: string | null;
  round: number;
  maxRounds: number;
}

export interface LookalikeJudgeInput {
  seed: LookalikeProfile & { name: string };
  company: { name: string; domain: string | null };
  offering: string;
  focus: string[];
  avoid: string[];
  facts: LookalikeKnownFact[];
}

export interface LookalikeJudgement {
  /** 0–100 per dimension of similarity to the seed and relevance to the client's offering. */
  dims: { business_model: number; operations: number; industry: number; scale: number; offering: number };
  readiness: "ready" | "emerging" | "early" | "none";
  readinessScore: number;
  reasons: string[];
  concerns: string[];
  /** The "rule out" item this company matches, if any. */
  avoidHit: string | null;
}
