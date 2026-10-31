import type { ConnectInput, ConnectOutput, EmailAuditOutput, InvestigateInput, InvestigateOutput, ValidateInput, ValidateOutput } from "@/lib/brain/research-types";
// Deterministic mock adapters. The same input always gives the same output, so
// tests are stable and every pipeline branch (layoffs, acquisitions, job changes,
// contradictions, weak evidence, bounces) shows up in seeded data.

import { rulePlan, ruleBrief, ruleCheckClaims, ruleInsights } from "@/lib/brain/rules";
import { HashEmbedder } from "./hash-embedder";
import { isTriggerKey } from "@/lib/research/keys";
import { classifyReplyRules } from "@/lib/journey/engine";
import { STAGE_INFO } from "@/lib/journey/stages";
import type { BrainStats, BriefInput, ClaimToCheck, PlanResearchInput } from "@/lib/brain/types";
import type {
  BrainSuggestInput,
  CritiqueInput,
  CritiqueOutput,
  Adapters,
  BriefingInput,
  DataProvider,
  DraftInput,
  EmailSender,
  ExtractedEvidence,
  IntentProvider,
  LLM,
  MailboxVerifier,
  Notifier,
  PersonQuery,
  ProviderPerson,
  ResearchPage,
  MarketEventExtract,
  SimilarCompanyExtract,
  LookalikeFact,
  LookalikeJudgeInput,
  LookalikeJudgement,
  LookalikePlanInput,
  LookalikeProfile,
  LookalikeQuestion,
  ResearchPass,
  ResearchSource,
  SearchHint,
  Validator,
} from "./types";
import { inferFunction } from "@/lib/pipeline/normalize";
import type { ProfileItems, ProfileKind } from "@/lib/profile/types";
import type { InfluencerInput, InfluencerRole } from "./types";
import { seller } from "@/lib/seller";
import { matchPersona } from "@/lib/seller/fit";

export function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Scenario per account, picked from the domain hash. */
export type Scenario = "strong" | "layoffs" | "acquired" | "acquired_rumour" | "weak" | "contradiction_unresolved" | "contradiction_official" | "weak_then_found";

export function scenarioFor(domain: string): Scenario {
  const forced = domain.match(/^(weak-then-found|contradiction-unresolved|contradiction-official|strong|layoffs|acquired-rumour|acquired|weak)-/);
  if (forced) return forced[1].replace(/-/g, "_") as Scenario;
  const h = hash(domain) % 12;
  if (h === 0) return "layoffs";
  if (h === 1) return "acquired";
  if (h === 2) return "weak";
  if (h === 3) return "contradiction_unresolved";
  if (h === 4) return "contradiction_official";
  if (h === 5) return "weak_then_found";
  return "strong";
}

function personScenario(fullName: string, domain: string): "ok" | "job_change" | "undeliverable" | "title_drift" {
  const forced = fullName.match(/\((job_change|undeliverable|title_drift)\)/);
  if (forced) return forced[1] as "job_change" | "undeliverable" | "title_drift";
  const h = hash(`${fullName.toLowerCase()}|${domain}`) % 14;
  if (h === 0) return "job_change";
  if (h === 1) return "undeliverable";
  if (h === 2) return "title_drift";
  return "ok";
}

// Titles the provider "knows" for discovered people, keyed by function.
const DISCOVERY: Record<string, { first: string; last: string; title: string }[]> = {
  data: [
    { first: "Priya", last: "Raman", title: "Chief Digital Officer" },
    { first: "Marco", last: "Silva", title: "Head of Master Data Governance" },
  ],
  it: [
    { first: "Rahul", last: "Menon", title: "CIO" },
    { first: "Tom", last: "Becker", title: "SAP CoE Lead" },
  ],
  procurement: [
    { first: "Kavita", last: "Iyer", title: "Chief Procurement Officer" },
    { first: "Owen", last: "Hughes", title: "Head of Vendor Management" },
  ],
  finance: [
    { first: "Grace", last: "Lin", title: "CFO" },
    { first: "Arvind", last: "Rao", title: "Head of Shared Services" },
  ],
  sales: [
    { first: "Sofia", last: "Fernandes", title: "Head of Distribution" },
    { first: "Dev", last: "Patel", title: "Sales Operations Manager" },
  ],
  security: [
    { first: "Aisha", last: "Bello", title: "CISO" },
    { first: "Liam", last: "Ortiz", title: "Head of Compliance" },
  ],
};

const emailFor = (first: string, last: string, domain: string) => `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + `@${domain}`;

const cleanName = (n: string) => n.replace(/\s*\([a-z_]+\)\s*/g, " ").trim();

class MockProvider implements DataProvider {
  name = "mock-provider";
  async lookupPerson({ fullName, domain, title = null }: PersonQuery): Promise<ProviderPerson | null> {
    const s = personScenario(fullName, domain);
    const name = cleanName(fullName);
    if (s === "job_change") {
      return { fullName: name, title: title ?? "Director", companyDomain: `new-employer-${hash(name) % 97}.example`, email: null, linkedinUrl: null, observedAt: daysAgo(12), source: this.name };
    }
    const [first, ...rest] = name.split(" ");
    return {
      fullName: name,
      title: s === "title_drift" ? `Senior ${title ?? "Manager"}` : title,
      companyDomain: domain,
      email: rest.length ? emailFor(first, rest.join(""), domain) : null,
      linkedinUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
      observedAt: daysAgo(5 + (hash(name) % 20)),
      source: this.name,
    };
  }

  async recheckPerson({ fullName, domain, title = null }: PersonQuery): Promise<ProviderPerson | null> {
    const s = personScenario(fullName, domain);
    const name = cleanName(fullName);
    // Title drift resolves on the second source; job changes stay conflicting.
    if (s === "job_change") return { fullName: name, title: title, companyDomain: `new-employer-${hash(name) % 97}.example`, email: null, linkedinUrl: null, observedAt: daysAgo(3), source: "mock-provider-b" };
    return { fullName: name, title, companyDomain: domain, email: null, linkedinUrl: null, observedAt: daysAgo(2), source: "mock-provider-b" };
  }

  async findByFunction(domain: string, fn: string, limit: number): Promise<ProviderPerson[]> {
    const list = DISCOVERY[fn] ?? DISCOVERY.it;
    return list.slice(0, limit).map((p) => ({
      fullName: `${p.first} ${p.last}`,
      title: p.title,
      companyDomain: domain,
      email: null,
      linkedinUrl: `https://www.linkedin.com/in/${p.first}-${p.last}`.toLowerCase(),
      observedAt: daysAgo(7),
      source: this.name,
    }));
  }

  /** One sample person per title, named from the title (deterministic), for the first `limit` titles. */
  async findByTitles(domain: string, titles: string[], limit: number): Promise<ProviderPerson[]> {
    const FIRST = ["Kavya", "Arjun", "Nisha", "Rohan", "Ishita", "Vikram", "Tara", "Sameer"];
    const LAST = ["Bose", "Nair", "Kulkarni", "Desai", "Reddy", "Joshi", "Malhotra", "Pillai"];
    return titles.slice(0, limit).map((title) => {
      const h = hash(`${domain}|${title}`);
      const first = FIRST[h % FIRST.length];
      const last = LAST[(h >> 3) % LAST.length];
      return { fullName: `${first} ${last}`, title, companyDomain: domain, email: null, linkedinUrl: `https://www.linkedin.com/in/${first}-${last}-${h % 1000}`.toLowerCase(), observedAt: daysAgo(7), source: this.name };
    });
  }

  async findEmail(fullName: string, domain: string): Promise<string | null> {
    const [first, ...rest] = cleanName(fullName).split(" ");
    if (!rest.length) return null;
    return emailFor(first, rest.join(""), domain);
  }
}

class MockMailbox implements MailboxVerifier {
  async verify(email: string) {
    const local = email.split("@")[0] ?? "";
    if (/bounce|invalid|undeliverable/.test(local)) return { deliverable: false, reason: "Mailbox does not exist" };
    return { deliverable: true, reason: "SMTP accepted" };
  }
}

const TRIGGERS = [
  { claim: "announced its SAP S/4HANA migration programme", value: "s4hana_migration" },
  { claim: "plans to add 3,000 distributors to expand rural reach", value: "distributor_expansion" },
  { claim: "is hiring a Head of Master Data Governance", value: "hiring_mdm" },
  { claim: "raised a Series D to scale seller onboarding", value: "series_d_sellers" },
  { claim: "completed the acquisition of a regional competitor", value: "acquisition" },
  { claim: "launched an enterprise-wide AI and automation programme", value: "ai_programme" },
];


/** Fictional market for the scan: pharma is heating up, FMCG cooling — the trend the radar must catch. */
export const MOCK_MARKET = [
  { name: "Sahyadri Lifesciences", industry: "pharmaceuticals", country: "India", employees: 18000, trigger: "erp_migration", claim: "began its SAP S/4HANA migration to unify plant and distributor master data", days: 6 },
  { name: "Narmada Pharma", industry: "pharmaceuticals", country: "India", employees: 9200, trigger: "channel_expansion", claim: "will add 2,500 stockists and chemist distributors across tier-3 towns", days: 11 },
  { name: "Kaveri Biologics", industry: "pharmaceuticals", country: "India", employees: 7400, trigger: "compliance_mandate", claim: "is rolling out serialisation and supplier KYC checks to meet new CDSCO track-and-trace rules", days: 15 },
  { name: "Godavari Generics", industry: "pharmaceuticals", country: "India", employees: 3100, trigger: "channel_expansion", claim: "is expanding its distributor network into East India", days: 19 },
  { name: "Vindhya Healthcare", industry: "pharmaceuticals", country: "India", employees: 12500, trigger: "ma_integration", claim: "completed the acquisition of a regional API maker and will merge vendor masters", days: 24 },
  { name: "Tapti Remedies", industry: "pharmaceuticals", country: "India", employees: 6100, trigger: "erp_migration", claim: "announced an ERP upgrade across eight formulation plants", days: 70 },
  { name: "Lotus Consumer Brands", industry: "fmcg", country: "India", employees: 8800, trigger: "channel_expansion", claim: "plans to add 1,200 rural distributors", days: 52 },
  { name: "Saffron Foods", industry: "fmcg", country: "India", employees: 6400, trigger: "erp_migration", claim: "went live on SAP S/4HANA for its dairy business", days: 64 },
  { name: "Marina Retail Group", industry: "fmcg", country: "Singapore", employees: 22000, trigger: "channel_expansion", claim: "is expanding its dealer network across South-East Asia", days: 9 },
  { name: "Indus Tyres", industry: "automotive", country: "India", employees: 14000, trigger: "hiring", claim: "is hiring a Head of Master Data and 12 SAP consultants for vendor onboarding", days: 8 },
  { name: "Konkan Auto Components", industry: "automotive", country: "India", employees: 11000, trigger: "workforce_scale", claim: "is hiring thousands of field technicians for its new plants", days: 28 },
];
const MARKET_BY_NAME = new Map(MOCK_MARKET.map((m) => [m.name.toLowerCase(), m]));

class MockResearch implements ResearchSource {
  engines() {
    return ["mock"];
  }

  async search(domain: string, companyName: string, key: string, pass: ResearchPass, hint: SearchHint = {}): Promise<ResearchPage[]> {
    const pages = (await this.pages(domain, companyName, key, pass)).map((p) => ({ ...p, engine: "mock" }));
    hint.onAttempt?.({ engine: "mock", results: pages.length });
    return pages;
  }

  private async pages(domain: string, companyName: string, key: string, pass: ResearchPass): Promise<ResearchPage[]> {
    const sc = scenarioFor(domain);
    const h = hash(domain);
    const pages: ResearchPage[] = [];
    const base = `https://${domain}`;
    if (key === "trigger") {
      if (sc === "weak") return [];
      if (sc === "weak_then_found") {
        // Main pass finds one news source; the follow-up finds a second, independent one.
        const t = TRIGGERS[h % TRIGGERS.length];
        if (pass === "main") pages.push({ url: `https://news.example.com/${domain}/${t.value}`, sourceType: "news", publishedAt: daysAgo(20 + (h % 30)), title: `${companyName} ${t.claim}`, text: `${companyName} ${t.claim}.` });
        else {
          const t2 = TRIGGERS[(h + 1) % TRIGGERS.length];
          pages.push({ url: `https://industryjournal.example.org/${domain}/${t2.value}`, sourceType: "press", publishedAt: daysAgo(12), title: `${companyName} ${t2.claim}`, text: `${companyName} ${t2.claim}.` });
        }
        return pages;
      }
      const t1 = TRIGGERS[h % TRIGGERS.length];
      const t2 = TRIGGERS[(h + 2) % TRIGGERS.length];
      pages.push({ url: `${base}/press/${t1.value}`, sourceType: "official", publishedAt: daysAgo(10 + (h % 40)), title: `${companyName} ${t1.claim}`, text: `${companyName} ${t1.claim}.` });
      pages.push({ url: `https://techwire.example.com/${domain}-${t2.value}`, sourceType: "press", publishedAt: daysAgo(15 + (h % 50)), title: `${companyName} ${t2.claim}`, text: `${companyName} ${t2.claim}.` });
      return pages;
    }
    if (key === "website") {
      // Companies imported without a website: their own site, found by name (some are not findable).
      const slug = companyName.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc)\b/g, "").replace(/[^a-z0-9]+/g, "");
      if (hash(companyName) % 7 === 0) return [{ url: `https://www.zaubacorp.example/company/${slug}`, sourceType: "news", publishedAt: daysAgo(100), title: `${companyName} - company profile`, text: `${companyName} directory listing` }];
      return [
        { url: `https://www.linkedin.com/company/${slug}`, sourceType: "news", publishedAt: daysAgo(5), title: `${companyName} | LinkedIn`, text: `${companyName} on LinkedIn` },
        { url: `https://www.${slug}.in/`, sourceType: "official", publishedAt: daysAgo(5), title: `${companyName} — Official website`, text: `Welcome to ${companyName}.` },
      ];
    }
    if (key === "firmographics" && MARKET_BY_NAME.has(companyName.toLowerCase())) {
      const m = MARKET_BY_NAME.get(companyName.toLowerCase())!;
      return [{ url: `https://companies.example.org/${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, sourceType: "news", publishedAt: daysAgo(30), title: `About ${companyName}`, text: `${companyName} is a ${m.industry} company headquartered in ${m.country} with about ${m.employees.toLocaleString("en-IN")} employees.` }];
    }
    if (key.startsWith("profile:")) return mockProfilePages(key.slice(8), domain, companyName, h);
    if (key === "lookalike_profile") {
      // What the company does: its own site and a directory both describe it (two sources).
      const m = MARKET_BY_NAME.get(companyName.toLowerCase());
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const about = m
        ? `${companyName} is a ${m.industry} company headquartered in ${m.country} with about ${m.employees.toLocaleString("en-IN")} employees. ${companyName} sells through a network of distributors and runs several manufacturing plants.`
        : `${companyName} is a fmcg company headquartered in India with about 9,000 employees. ${companyName} sells through a network of distributors and runs several manufacturing plants.`;
      return [
        { url: `https://www.${slug}.example.in/about`, sourceType: "official", publishedAt: daysAgo(30), title: `About ${companyName}`, text: about },
        { url: `https://companies.example.org/${slug}`, sourceType: "news", publishedAt: daysAgo(60), title: `${companyName} company profile`, text: about },
      ];
    }
    if (key === "lookalike_intent") {
      const m = MARKET_BY_NAME.get(companyName.toLowerCase());
      if (!m || m.trigger === "hiring") return [];
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return [
        { url: `https://marketwire.example.com/${slug}-${m.trigger}`, sourceType: "news", publishedAt: daysAgo(m.days), title: `${companyName} ${m.claim}`, text: `${companyName} ${m.claim}.` },
        { url: `https://businessdaily.example.in/${slug}`, sourceType: "press", publishedAt: daysAgo(m.days + 2), title: `${companyName} ${m.claim}`, text: `${companyName} ${m.claim}.` },
      ];
    }
    if (key === "lookalike" || key === "lookalike_discover") {
      // A "companies like X" page naming peers from the sample market.
      return [{ url: `https://peerlist.example.com/${(domain || companyName).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, sourceType: "news" as const, publishedAt: daysAgo(40), title: `Companies similar to ${companyName}`, text: MOCK_MARKET.map((m) => `${m.name} is a ${m.industry} company and a peer of ${companyName}.`).join(" ") }];
    }
    if (key.startsWith("market")) {
      return MOCK_MARKET.map((m) => ({ url: `https://marketwire.example.com/${m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${m.trigger}`, sourceType: "news" as const, publishedAt: daysAgo(m.days), title: `${m.name} ${m.claim}`, text: `${m.name} ${m.claim}. The ${m.industry} company is based in ${m.country}.` }));
    }
    if (key === "firmographics") {
      const industries = ["fmcg", "manufacturing", "pharma distribution", "quick commerce", "nbfc lending"];
      return [{ url: domain ? `https://${domain}/about` : `https://companies.example.org/${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, sourceType: domain ? "official" : "news", publishedAt: daysAgo(30), title: `About ${companyName}`, text: `${companyName} is a ${industries[h % industries.length]} company headquartered in India with about ${(800 + (h % 40) * 100).toLocaleString("en-IN")} employees.` }];
    }
    if (["erp_program", "expansion", "leadership", "compliance"].includes(key)) {
      // Deep-dive answers exist for well-documented companies only.
      if (sc !== "strong" && sc !== "contradiction_official" && sc !== "contradiction_unresolved") return [];
      const text: Record<string, string> = {
        erp_program: `${companyName} selected an implementation partner for its SAP S/4HANA and master data programme`,
        expansion: `${companyName} plans to add ${1 + (h % 4)},000 distributors and retailers in East India this year`,
        leadership: `${companyName} appointed a new Chief Digital Officer to lead its data and automation agenda`,
        compliance: `${companyName} is preparing for GST e-invoicing and stricter supplier KYC audits`,
      };
      if (key === "leadership" && h % 3 === 0) return [];
      return [{ url: key === "leadership" ? `https://news.example.com/${domain}/leadership` : `${base}/press/${key}`, sourceType: key === "leadership" ? "news" : "official", publishedAt: daysAgo(20 + (h % 50)), title: text[key], text: `${text[key]}.` }];
    }
    if (key === "owner_function") {
      const fns = ["data", "procurement", "it", "sales", "finance"];
      const fn = fns[h % fns.length];
      pages.push({ url: `${base}/careers`, sourceType: "careers", publishedAt: daysAgo(8), title: "Careers", text: `Open roles for vendor and partner onboarding reporting into the ${fn} organisation.` });
      return pages;
    }
    if (key === "negative") {
      // Confirmed blockers come from two independent sites; a rumour from one.
      if (sc === "layoffs") pages.push({ url: `https://news.example.com/${domain}/layoffs`, sourceType: "news", publishedAt: daysAgo(25), title: `${companyName} cuts 8% of staff`, text: "layoffs" }, { url: `https://wire.example.org/${domain}/layoffs`, sourceType: "news", publishedAt: daysAgo(24), title: `${companyName} job cuts`, text: "layoffs" });
      if (sc === "acquired") pages.push({ url: `https://news.example.com/${domain}/acquired`, sourceType: "news", publishedAt: daysAgo(40), title: `${companyName} acquired by MegaCorp`, text: "acquired" }, { url: `https://wire.example.org/${domain}/acquired`, sourceType: "news", publishedAt: daysAgo(39), title: `MegaCorp completes its acquisition of ${companyName}`, text: "acquired" });
      if (sc === "acquired_rumour") pages.push({ url: `https://gossip.example.com/${domain}/acquired`, sourceType: "news", publishedAt: daysAgo(10), title: `${companyName} to be acquired by MegaCorp, sources say`, text: "acquired" });
      // Finding no negative news is still an answer (recorded by the LLM step).
      return pages;
    }
    if (key === "investigation") {
      // Follow-up questions: well-documented companies have an independent report on their programme.
      if (sc !== "strong") return [];
      return [{ url: `https://industrynews.example.net/${domain}/programme`, sourceType: "news", publishedAt: daysAgo(18 + (h % 20)), title: `${companyName} rolls out its master data programme to distributors`, text: `${companyName} rolls out its master data programme to distributors.` }];
    }
    if (key === "tooling") {
      pages.push({ url: `https://stackreviews.example.com/${domain}`, sourceType: "review_site", publishedAt: daysAgo(60), title: "Stack", text: ["SAP ECC, Excel-based vendor forms", "SAP S/4HANA, Informatica MDM", "Oracle EBS, Power Apps", "Microsoft Dynamics 365, manual KYC"][h % 4] });
      return pages;
    }
    if (key === "partner_network") {
      // A reopen pass on an unresolved contradiction finds nothing new.
      if (pass === "reopen" && sc === "contradiction_unresolved") return pages;
      if (sc === "contradiction_unresolved") {
        pages.push({ url: `https://bizdaily.example.com/${domain}`, sourceType: "news", publishedAt: daysAgo(30), title: "Partner network", text: "4000" });
        pages.push({ url: `https://startupwatch.example.com/${domain}`, sourceType: "press", publishedAt: daysAgo(35), title: "Partner network", text: "12000" });
      } else if (sc === "contradiction_official") {
        pages.push({ url: `https://bizdaily.example.com/${domain}`, sourceType: "news", publishedAt: daysAgo(30), title: "Partner network", text: "4000" });
        pages.push({ url: `${base}/about`, sourceType: "official", publishedAt: daysAgo(14), title: "About", text: "8500" });
      } else {
        pages.push({ url: `${base}/about`, sourceType: "official", publishedAt: daysAgo(20), title: "About", text: String(500 + (h % 90) * 100) });
      }
      return pages;
    }
    return pages;
  }
}

const NEGATIVE_KINDS: Record<string, string> = { layoffs: "layoffs", acquired: "acquired", bankrupt: "bankrupt", freeze: "hiring_freeze" };

class MockLLM implements LLM {
  readonly model = "mock";

  /** Round 1: one hypothesis from the trigger facts and one disconfirming question; then done. */
  async investigate(input: InvestigateInput): Promise<InvestigateOutput> {
    const pos = input.facts.filter((f) => !f.negative && isTriggerKey(f.key));
    if (input.round > 1 || !pos.length) return { hypotheses: [], questions: [], done: true, doneWhy: pos.length ? "Hypothesis tested" : "No client-relevant development found" };
    const uc = input.relevance.useCases[0]?.key ?? null;
    const existing = input.hypotheses[0];
    return {
      hypotheses: [{ ref: existing?.id ?? "new", text: `${input.company.name}'s ${pos[0].claim.replace(new RegExp(`^${input.company.name}\\s*`, "i"), "")} may create a need for ${uc?.replace(/_/g, " ") ?? "the offering"}`, useCase: uc, assumptions: ["The change touches partner or vendor onboarding"], supportIds: pos.slice(0, 3).map((f) => f.id), counterIds: [] }],
      questions: [
        { question: `Is the programme already served by another supplier?`, query: `"${input.company.name}" master data programme partner rollout`, purpose: "disconfirm", hypothesisRef: existing?.id ?? "new", value: 4, why: "An incumbent would remove the need" },
      ],
      done: false,
      doneWhy: "",
    };
  }

  /** Two or more supporting facts → supported opportunity; one → relevant development; none → inconclusive. */
  async connectEvidence(input: ConnectInput): Promise<ConnectOutput> {
    const uc = input.relevance.useCases[0]?.key ?? "general";
    return {
      hypotheses: input.hypotheses.map((h) => ({ id: h.id, classification: h.supportIds.length >= 2 ? ("supported_opportunity" as const) : h.supportIds.length ? ("relevant_development" as const) : ("inconclusive" as const), useCase: h.useCase ?? uc, rationale: "Sample connection from the supporting facts", supportIds: h.supportIds, counterIds: h.counterIds, alternatives: [] })),
      links: input.hypotheses.flatMap((h) => h.supportIds.map((id) => ({ hypothesisId: h.id, from: `fact:${id}`, relation: "may_create_need_for" as const, to: `capability:${h.useCase ?? uc}`, rationale: "Sample link", evidenceIds: [id] }))),
    };
  }

  /** Sample emails are built only from fact-cited claims: nothing to flag. */
  async auditEmail(): Promise<EmailAuditOutput> {
    return { sentences: [] };
  }

  planResearch(input: PlanResearchInput) {
    return Promise.resolve(rulePlan(input));
  }

  accountBrief(input: BriefInput) {
    return Promise.resolve(ruleBrief(input));
  }

  checkClaims(claims: ClaimToCheck[]) {
    return Promise.resolve(ruleCheckClaims(claims));
  }

  insights(stats: BrainStats) {
    return Promise.resolve(ruleInsights(stats));
  }

  /**
   * Sample proposals: four grounded roles, plus two the code must reject (an obvious CFO and a role
   * citing a fact that doesn't exist), so the validation is exercised.
   */
  async proposeInfluencers(input: InfluencerInput): Promise<InfluencerRole[]> {
    if (!input.facts.length) return [];
    const f = (i: number) => input.facts[Math.min(i, input.facts.length - 1)].id;
    return [
      { title: "Head of SAP Centre of Excellence", searchTitles: ["Head of SAP Centre of Excellence", "SAP CoE Lead"], group: "data", why: "Runs the programme the facts describe, so owns how master data moves into the new system", factIds: [f(0)] },
      { title: "Head of Internal Audit", searchTitles: ["Head of Internal Audit", "Internal Audit Head"], group: "risk_compliance", why: "Signs off controls on vendor and customer data during the change the facts describe", factIds: [f(0)] },
      { title: "Plant Head", searchTitles: ["Plant Head", "Plant Manager"], group: "operations", why: "New sites and suppliers in the facts land on plant teams first, who feel onboarding delays", factIds: [f(1)] },
      { title: "Accounts Payable Lead", searchTitles: ["Accounts Payable Lead", "Head of Accounts Payable"], group: "finance", why: "Pays the new vendors the facts imply, and carries the cost of wrong bank details", factIds: [f(1)] },
      { title: "Chief Financial Officer", searchTitles: ["CFO"], group: "finance", why: "Approves the budget for the programme described in the facts", factIds: [f(0)] },
      { title: "Head of Treasury", searchTitles: ["Head of Treasury"], group: "finance", why: "Manages cash flows affected by an event that was never found", factIds: ["no_such_fact"] },
    ];
  }

  async extractProfile<K extends ProfileKind>(kind: K, pages: ResearchPage[]): Promise<ProfileItems[K]> {
    return mockExtractProfile(kind, pages) as ProfileItems[K];
  }

  async extractFirmographics(pages: ResearchPage[]) {
    for (const [i, p] of pages.entries()) {
      const m = p.text.match(/is an? (.+?) company headquartered in ([A-Za-z ]+?) with about ([\d,]+) employees/);
      if (m) return { industry: m[1], country: m[2], employees: Number(m[3].replace(/,/g, "")), page: i };
    }
    return null;
  }

  async extractMarketEvents(pages: ResearchPage[]): Promise<MarketEventExtract[]> {
    const out: MarketEventExtract[] = [];
    for (const [i, p] of pages.entries()) {
      const m = MOCK_MARKET.find((x) => p.title.startsWith(x.name));
      if (m) out.push({ page: i, company: m.name, industry: m.industry, triggerKey: m.trigger, claim: `${m.name} ${m.claim}`, quote: `${m.name} ${m.claim}` });
    }
    return out;
  }

  async extractSimilarCompanies(pages: ResearchPage[], seed: { name: string }): Promise<SimilarCompanyExtract[]> {
    const out: SimilarCompanyExtract[] = [];
    for (const [i, p] of pages.entries())
      for (const m of MOCK_MARKET) if (p.text.includes(`${m.name} is a`) && m.name !== seed.name) out.push({ page: i, name: m.name, domain: null, reason: `${m.industry} peer`, quote: `${m.name} is a ${m.industry} company` });
    return out;
  }

  // ── Lookalikes (deterministic) ──

  async profileCompany(pages: ResearchPage[], company: string): Promise<LookalikeProfile | null> {
    const p = pages.find((x) => x.text.includes(company));
    if (!p) return null;
    const industry = p.text.match(/is an? (.+?) company/)?.[1] ?? null;
    return { summary: p.text.split(/(?<=\.)\s/)[0], businessModel: "Makes and sells products through distributors", operations: "Manufacturing plants and a distributor network", industry, customers: "Distributors and retailers", scale: p.text.match(/about ([\d,]+) employees/)?.[0] ?? "unknown", offeringFit: "Onboards many partners and vendors" };
  }

  async planLookalike(input: LookalikePlanInput): Promise<{ questions: LookalikeQuestion[]; done: boolean; why: string }> {
    const c = input.company.name;
    const ask = (question: string, dimension: LookalikeQuestion["dimension"], engine: "exa" | "tavily"): LookalikeQuestion => ({ question, why: "Changes the conclusion", query: `"${c}" ${question}`, engine, dimension });
    let qs: LookalikeQuestion[] = [];
    if (input.round === 1) qs = [ask("What does it do and how does it operate?", "operations", "exa"), ask("Any recent expansion, system change or hiring?", "intent", "tavily")];
    else if (input.note) qs = [ask(input.note, "offering", "exa")];
    qs = qs.filter((q) => !input.asked.includes(q.question));
    return { questions: qs, done: !qs.length || input.round >= Math.min(2, input.maxRounds), why: qs.length ? "Open questions" : "Enough to judge" };
  }

  async extractLookalikeFacts(pages: ResearchPage[], company: string, question: LookalikeQuestion): Promise<LookalikeFact[]> {
    const out: LookalikeFact[] = [];
    for (const [i, p] of pages.entries())
      for (const sentence of p.text.split(/(?<=\.)\s/).filter((x) => x.includes(company)).slice(0, 2)) {
        const dimension = question.dimension === "intent" ? "intent" : /distributor|plant/.test(sentence) ? "operations" : /employees/.test(sentence) ? "scale" : question.dimension;
        out.push({ page: i, claim: sentence.replace(/\.$/, ""), quote: sentence, dimension });
      }
    return out;
  }

  async judgeLookalike(input: LookalikeJudgeInput): Promise<LookalikeJudgement> {
    const text = input.facts.map((f) => f.claim.toLowerCase()).join(" ");
    const has = (d: string) => input.facts.some((f) => f.dimension === d);
    const industry = input.seed.industry && text.includes(input.seed.industry.toLowerCase()) ? 85 : has("industry") || has("scale") ? 45 : 30;
    const intent = input.facts.filter((f) => f.dimension === "intent");
    const verifiedIntent = intent.filter((f) => f.verified).length;
    const avoidHit = input.avoid.find((a) => text.includes(a.toLowerCase())) ?? null;
    return {
      dims: { business_model: has("operations") ? 75 : 30, operations: has("operations") ? 80 : 30, industry, scale: has("scale") ? 70 : 30, offering: /distributor|vendor|erp|sap|master data/.test(text) ? 75 : 40 },
      readiness: verifiedIntent ? "ready" : intent.length ? "emerging" : "early",
      readinessScore: verifiedIntent ? 80 : intent.length ? 55 : 25,
      reasons: input.facts.slice(0, 3).map((f) => f.claim),
      concerns: intent.length ? [] : ["No current buying event found"],
      avoidHit,
    };
  }

  async suggestBrainItems(input: BrainSuggestInput): Promise<Record<string, string>[]> {
    if (!input.context.length) return [];
    const item = Object.fromEntries(input.fields.map((f) => [f.key, f.kind === "bool" ? "false" : f.options ? f.options[0] : f.kind === "number" ? "100" : `Suggested ${f.label.toLowerCase()} from ${input.context[0].title}`]));
    return [item];
  }

  classifyJourneyReply(text: string) {
    const r = classifyReplyRules(text);
    return Promise.resolve({ stage: r.stage, reason: r.reason, nextAction: STAGE_INFO[r.stage].next });
  }

  async extractEvidence(pages: ResearchPage[], key: string): Promise<ExtractedEvidence[]> {
    if (key === "negative" && pages.length === 0) return [];
    const quoteOf = (p: ResearchPage) => (p.text && p.text.length > 12 ? p.text.split(/(?<=[.!?])\s/)[0] : `${p.title} ${p.text ?? ""}`.trim()).slice(0, 240);
    return pages.map((p): ExtractedEvidence => ({ ...this.extractOne(p, key), quote: quoteOf(p) }));
  }

  private extractOne(p: ResearchPage, key: string): ExtractedEvidence {
    {
      if (key === "negative") {
        const kind = Object.keys(NEGATIVE_KINDS).find((k) => p.text.includes(k)) ?? "layoffs";
        return { key, claim: p.title, value: NEGATIVE_KINDS[kind], sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative: true, negativeKind: NEGATIVE_KINDS[kind] };
      }
      if (key === "owner_function") {
        const fn = p.text.match(/into the (\w+) organisation/)?.[1] ?? null;
        return { key, claim: `The ${fn} team owns partner and vendor onboarding (careers page)`, value: fn, sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative: false, negativeKind: null };
      }
      if (key === "partner_network") return { key, claim: `Works with about ${Number(p.text).toLocaleString("en-IN")} distributors, vendors and partners`, value: p.text, sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative: false, negativeKind: null };
      if (key === "tooling") return { key, claim: `Current stack includes ${p.text}`, value: null, sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative: false, negativeKind: null };
      return { key, claim: p.title, value: null, sourceUrl: p.url, sourceType: p.sourceType, publishedAt: p.publishedAt, isNegative: false, negativeKind: null };
    }
  }

  async infer(facts: { id: string; key: string; claim: string }[]) {
    const out: { text: string; basedOn: string[] }[] = [];
    const triggers = facts.filter((f) => isTriggerKey(f.key));
    const owner = facts.find((f) => f.key === "owner_function");
    if (triggers.length && owner) out.push({ text: "Likely reviewing how partner and vendor data is onboarded this half — a growth trigger plus active hiring in the owning team", basedOn: [triggers[0].id, owner.id] });
    const tooling = facts.find((f) => f.key === "tooling");
    if (tooling) out.push({ text: /sap|oracle|dynamics/i.test(tooling.claim) ? "An established ERP means validated master data has a clear destination — integration risk is low" : "Manual onboarding tools suggest room for automation", basedOn: [tooling.id] });
    return out;
  }

  async mapRole(title: string | null, ownerFunction: string | null, contactFunction: string | null) {
    if (!title) return "unknown" as const;
    // The seller's personas decide first; a real LLM gets the same personas as guidance.
    const persona = matchPersona(title, seller());
    if (persona) {
      const fn = contactFunction ?? inferFunction(title);
      // A decision maker outside the owning function influences rather than decides.
      if (persona.role === "decision_maker" && ownerFunction && fn && !persona.functions.includes(ownerFunction) && fn !== ownerFunction) return "influencer" as const;
      return persona.role;
    }
    const t = title.toLowerCase();
    const inOwner = ownerFunction ? (contactFunction ?? inferFunction(title)) === ownerFunction : false;
    if (/\b(cfo|finance|procurement)\b/.test(t) && !inOwner) return "budget_owner" as const;
    if (/\b(chief|vp|vice president|ceo|cto|cdo|ciso|cio|head)\b/.test(t)) return inOwner || !ownerFunction ? ("decision_maker" as const) : ("influencer" as const);
    if (/\b(director|manager|lead|principal|architect)\b/.test(t)) return inOwner ? ("champion" as const) : ("influencer" as const);
    return "unknown" as const;
  }

  async draft(input: DraftInput, attempt: number) {
    const lead = input.facts.find((f) => isTriggerKey(f.key)) ?? input.facts[0];
    const support = input.facts.find((f) => f.key === "owner_function" && f.id !== lead?.id);
    const hi = input.firstName ? `Hi ${input.firstName},` : "Hi,";
    const claims: { text: string; factIds: string[] }[] = [];

    // LinkedIn: short, no subject, no footer, shaped by the play.
    if (input.channel === "linkedin") {
      const about = lead ? lead.claim.replace(new RegExp(`^${input.company}\\s+`, "i"), "") : "";
      const said = lead ? `saw that ${input.company} ${about}`.replace(/\.$/, "") : `glad to see ${input.company}'s progress`;
      let body: string;
      if (input.writing?.play.key === "linkedin_connect") {
        body = `Hi ${input.firstName ?? "there"}, ${said}. Would be glad to connect.`;
        const max = input.writing.play.limits.maxChars ?? 200;
        if (body.length > max) body = `Hi ${input.firstName ?? "there"}, following ${input.company}'s recent news. Would be glad to connect.`;
      } else {
        body = `Thanks for connecting, ${input.firstName ?? "there"}. I ${said}. How is your team handling partner onboarding through that?`;
      }
      if (lead && body.includes(about.slice(0, 20))) claims.push({ text: body, factIds: [lead.id] });
      return { subject: "", body, angle: lead?.key ?? null, claims };
    }

    const lines: string[] = [hi, ""];
    if (lead) {
      const text = `I saw that ${input.company} ${lead.claim.replace(new RegExp(`^${input.company}\\s+`, "i"), "")}.`;
      lines.push(text);
      // First attempt sometimes forgets to cite, exercising the regenerate path.
      claims.push({ text, factIds: attempt === 1 && input.stepOrder === 99 ? [] : [lead.id] });
    }
    if (support) {
      const text = `It looks like your ${support.claim.match(/The (\w+) team/)?.[1] ?? "operations"} team is hiring for partner and vendor onboarding at the same time.`;
      lines.push(text);
      claims.push({ text, factIds: [support.id] });
    }
    // The brain's angle for this person, asked as a question (a hypothesis, not a fact).
    if (input.angle && input.stepOrder === 1) lines.push("", `Is ${input.angle.pain.split(" — ")[0].replace(/^./, (c) => c.toLowerCase())} something your team is dealing with?`);
    // Approved seller collateral (about the seller, not the prospect).
    let pitch = input.seller.pitch;
    const tail = () => (input.stepOrder === 1 ? `${pitch}\n\n${input.seller.cta}` : `Following up on my last note — ${input.instruction.toLowerCase()}. ${pitch}`);
    // Respect the play's length: drop the supporting line, then shorten the pitch to its first sentence.
    const max = input.writing?.play.limits.maxWords;
    const count = () => [...lines, tail()].join(" ").split(/\s+/).filter(Boolean).length;
    if (max && count() > max && support) {
      const i = lines.findIndex((l) => l.startsWith("It looks like your"));
      if (i >= 0) {
        lines.splice(i, 1);
        claims.splice(claims.findIndex((c) => c.factIds[0] === support.id), 1);
      }
    }
    if (max && count() > max) pitch = pitch.split(/(?<=\.)\s/)[0];
    lines.push("", tail());
    lines.push("", `${input.sender.name}`, `${input.sender.company} · ${input.sender.address}`, "", "Reply \"unsubscribe\" and I won't email again.");
    return {
      subject: input.stepOrder === 1 ? `${input.company} + ${input.seller.name}` : `Re: ${input.company} + ${input.seller.name}`,
      body: lines.join("\n"),
      angle: lead?.key ?? null,
      claims,
    };
  }

  /** Sample critic: length, hype words and the seller's banned claims. */
  async critiqueDraft(input: CritiqueInput): Promise<CritiqueOutput> {
    const body = input.body.split(/\n\n[^\n]*\n[^\n]* · /)[0];
    const issues: string[] = [];
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words > 150) issues.push(`Too long (${words} words) — cut to under 120`);
    const hype = body.match(/\b(revolutionary|game[- ]changing|synergy|world[- ]class|cutting[- ]edge)\b/i);
    if (hype) issues.push(`Hype word "${hype[0]}" — say what it does instead`);
    const banned = input.bannedClaims.find((b: string) => b.length < 40 && body.toLowerCase().includes(b.toLowerCase()));
    if (banned) issues.push(`Banned claim: ${banned}`);
    return { pass: issues.length === 0, issues, strengths: issues.length ? [] : ["Specific, short, ends with one question"] };
  }

  async classifyReply(text: string) {
    const t = text.toLowerCase();
    if (/unsubscribe|remove me|stop emailing/.test(t)) return "unsubscribe" as const;
    if (/out of (the )?office|on leave|vacation|ooo/.test(t)) return "out_of_office" as const;
    if (/not the right person|wrong person|no longer|talk to|reach out to/.test(t)) return "wrong_person" as const;
    if (/not now|next quarter|later this year|circle back|timing/.test(t)) return "not_now" as const;
    if (/interested|let'?s talk|book|schedule|sounds good|yes/.test(t)) return "positive" as const;
    if (/already use|no budget|not a priority|happy with/.test(t)) return "objection" as const;
    return "needs_human" as const;
  }

  async briefing(input: BriefingInput) {
    const top = input.facts.slice(0, 4);
    return {
      whyNow: top[0] ? `${input.company}: ${top[0].claim}. Triggered by ${input.trigger.replace("_", " ")}.` : `${input.company} engaged (${input.trigger.replace("_", " ")}).`,
      facts: top.map((f) => ({ text: f.claim, factId: f.id })),
      unknowns: input.unknowns,
      engaged: input.engaged,
    };
  }
}

class MockEmail implements EmailSender {
  sent = new Map<string, string>();
  async send(msg: { idempotencyKey: string }) {
    const existing = this.sent.get(msg.idempotencyKey);
    if (existing) return { providerId: existing };
    const id = `mock_${hash(msg.idempotencyKey).toString(36)}`;
    this.sent.set(msg.idempotencyKey, id);
    return { providerId: id };
  }
}

class MockIntent implements IntentProvider {
  async intent(domain: string) {
    const h = hash(`intent:${domain}`);
    const score = h % 100;
    const topics = ["data observability", "data quality", "pipeline monitoring", "dbt", "warehouse cost"].filter((_, i) => (h >> i) & 1).slice(0, 3);
    return { score, topics };
  }
}

class MockNotifier implements Notifier {
  log: { to: string; subject: string }[] = [];
  async alert(to: string, subject: string) {
    this.log.push({ to, subject });
  }
}

export function createMockAdapters(): Adapters & { provider: MockProvider } {
  return {
    provider: new MockProvider(),
    mailbox: new MockMailbox(),
    research: new MockResearch(),
    llm: new MockLLM(),
    email: new MockEmail(),
    intent: new MockIntent(),
    notifier: new MockNotifier(),
    embedder: new HashEmbedder(),
    validator: new MockValidator(),
  };
}

/** Upholds every hypothesis as classified (sample data). */
class MockValidator implements Validator {
  readonly model = "mock";
  async validateResearch(input: ValidateInput): Promise<ValidateOutput> {
    return { results: input.hypotheses.map((h) => ({ hypothesisId: h.id, verdict: "upheld" as const, classification: h.classification as ValidateOutput["results"][number]["classification"], issues: [], alternatives: [], repairQuestions: [] })) };
  }
}

export type MockAdapters = ReturnType<typeof createMockAdapters>;

// ── Company profile (sample data in the formats real sources use) ──

/**
 * Sample profile pages. Every company gets two years of results (one on its own investor page,
 * one in the press, so the latest year is corroborated), a job post naming its ERP and CRM, and a
 * board page. Companies whose domain hash is divisible by 3 also announced a funding round.
 */
export function mockProfilePages(kind: string, domain: string, company: string, h: number): ResearchPage[] {
  const slug = domain || company.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const rev = 2000 + (h % 4000);
  const prev = Math.round(rev * 0.9);
  const profit = Math.round(rev * 0.08);
  if (kind === "financials") {
    const fy = `${company} reported revenue from operations of ₹${rev.toLocaleString("en-IN")} crore for FY2024-25, with net profit of ₹${profit.toLocaleString("en-IN")} crore.`;
    const fyPrev = `For FY2023-24, ${company} posted revenue of ₹${prev.toLocaleString("en-IN")} crore and a net profit of ₹${Math.round(prev * 0.07).toLocaleString("en-IN")} crore.`;
    return [
      { url: `https://${slug}/investors/annual-results-fy25`, sourceType: "official", publishedAt: daysAgo(120), title: `${company} annual results FY2024-25`, text: `${fy} ${fyPrev}` },
      { url: `https://businessdaily.example.com/${slug}-fy25-results`, sourceType: "news", publishedAt: daysAgo(118), title: `${company} FY25 results`, text: fy },
    ];
  }
  if (kind === "funding") {
    if (h % 3 !== 0) return [];
    const amt = 20 + (h % 60);
    return [{ url: `https://startupwire.example.com/${slug}-series-b`, sourceType: "news", publishedAt: daysAgo(200), title: `${company} raises Series B`, text: `${company} has raised $${amt} million in a Series B round led by Peak Growth Partners, with participation from Northstar Ventures.` }];
  }
  if (kind === "tech_stack") {
    return [{ url: `https://careers.example.com/${slug}/sap-lead`, sourceType: "careers", publishedAt: daysAgo(30), title: `${company} hiring SAP S/4HANA functional lead`, text: `${company} is hiring an SAP S/4HANA functional lead to support its migration from SAP ECC. Experience with Salesforce Sales Cloud integration is a plus.` }];
  }
  if (kind === "board") {
    return [{ url: `https://${slug}/about/board-of-directors`, sourceType: "official", publishedAt: daysAgo(60), title: `${company} board of directors`, text: `Meera Iyer is an Independent Director of ${company}. Rajiv Menon is the Chairman and Managing Director of ${company}. Dr. Anil Kapoor serves as a Strategic Adviser to ${company}.` }];
  }
  return [];
}

/** Reads the sample sentences above the way the AI reader would (numbers copied as written). */
export function mockExtractProfile(kind: ProfileKind, pages: ResearchPage[]): ProfileItems[ProfileKind] {
  const num = (x: string) => Number(x.replace(/,/g, ""));
  const out: unknown[] = [];
  pages.forEach((p, page) => {
    const sentences = p.text.split(/(?<=\.)\s+/);
    for (const q of sentences) {
      if (kind === "financials") {
        const m = q.match(/(FY\d{4}-\d{2}).*?revenue[^₹]*₹([\d,]+) crore.*?net profit of ₹([\d,]+) crore/i) ?? q.match(/revenue[^₹]*₹([\d,]+) crore for (FY\d{4}-\d{2}), with net profit of ₹([\d,]+) crore/i);
        if (m) {
          const [fy, r, n] = /^FY/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]];
          out.push({ page, fiscalYear: fy, currency: "INR", unit: "crore", revenue: num(r), netProfit: num(n), ebitda: null, consolidated: null, quote: q });
        }
      } else if (kind === "funding") {
        const m = q.match(/raised \$(\d+) million in a (Series [A-Z]) round led by ([^,]+), with participation from ([^.]+)\./);
        if (m) out.push({ page, round: m[2], amount: Number(m[1]), currency: "USD", unit: "million", announced: null, investors: [m[3], m[4]], leadInvestors: [m[3]], quote: q });
      } else if (kind === "tech_stack") {
        if (/SAP S\/4HANA/.test(q)) out.push({ page, tool: "SAP S/4HANA", context: "migrating_to", quote: q });
        if (/from SAP ECC/.test(q)) out.push({ page, tool: "SAP ECC", context: "migrating_from", quote: q });
        if (/Salesforce Sales Cloud/.test(q)) out.push({ page, tool: "Salesforce Sales Cloud", context: "hiring_for", quote: q });
      } else if (kind === "board") {
        const m = q.match(/^((?:Dr\. )?[A-Z][a-z]+ [A-Z][a-z]+) (?:is an?|is the|serves as an?) ([A-Z][A-Za-z ]+?) (?:of|to) /);
        if (m) {
          const role = m[2].trim();
          const type = /independent/i.test(role) ? "independent_director" : /adviser|advisor/i.test(role) ? "adviser" : /managing|executive|whole-time/i.test(role) ? "executive_director" : "board_member";
          out.push({ page, name: m[1], role, type, quote: q });
        }
      }
    }
  });
  return out as ProfileItems[ProfileKind];
}
