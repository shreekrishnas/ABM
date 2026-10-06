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
  verify(email: string): Promise<{ deliverable: boolean; reason: string }>;
}

export interface ResearchPage {
  url: string;
  sourceType: "official" | "press" | "news" | "careers" | "provider" | "review_site" | "mock";
  publishedAt: Date;
  title: string;
  text: string;
}

export type ResearchPass = "main" | "followup" | "reopen" | "refresh";

export interface ResearchSource {
  /** True for real web search; the evidence gate then refuses mock evidence. */
  readonly live?: boolean;
  search(domain: string, companyName: string, questionKey: string, pass: ResearchPass): Promise<ResearchPage[]>;
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
  extractEvidence(pages: ResearchPage[], questionKey: string): Promise<ExtractedEvidence[]>;
  infer(facts: { id: string; key: string; claim: string }[]): Promise<Inference[]>;
  mapRole(title: string | null, ownerFunction: string | null, contactFunction: string | null): Promise<"decision_maker" | "champion" | "influencer" | "budget_owner" | "unknown">;
  draft(input: DraftInput, attempt: number): Promise<DraftOutput>;
  classifyReply(text: string): Promise<"positive" | "objection" | "not_now" | "unsubscribe" | "wrong_person" | "out_of_office" | "needs_human">;
  briefing(input: BriefingInput): Promise<BriefingOutput>;
}

export interface EmailSender {
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
