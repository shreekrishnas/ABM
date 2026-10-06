// Deterministic mock adapters. The same input always gives the same output, so
// tests are stable and every pipeline branch (layoffs, acquisitions, job changes,
// contradictions, weak evidence, bounces) shows up in seeded data.

import type {
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
  ResearchPass,
  ResearchSource,
} from "./types";
import { inferFunction } from "@/lib/pipeline/normalize";
import { seller } from "@/lib/seller";
import { matchPersona } from "@/lib/seller/fit";

export function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Scenario per account, picked from the domain hash. */
export type Scenario = "strong" | "layoffs" | "acquired" | "weak" | "contradiction_unresolved" | "contradiction_official" | "weak_then_found";

export function scenarioFor(domain: string): Scenario {
  const forced = domain.match(/^(weak-then-found|contradiction-unresolved|contradiction-official|strong|layoffs|acquired|weak)-/);
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

class MockResearch implements ResearchSource {
  async search(domain: string, companyName: string, key: string, pass: ResearchPass): Promise<ResearchPage[]> {
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
    if (key === "owner_function") {
      const fns = ["data", "procurement", "it", "sales", "finance"];
      const fn = fns[h % fns.length];
      pages.push({ url: `${base}/careers`, sourceType: "careers", publishedAt: daysAgo(8), title: "Careers", text: `Open roles for vendor and partner onboarding reporting into the ${fn} organisation.` });
      return pages;
    }
    if (key === "negative") {
      if (sc === "layoffs") pages.push({ url: `https://news.example.com/${domain}/layoffs`, sourceType: "news", publishedAt: daysAgo(25), title: `${companyName} cuts 8% of staff`, text: "layoffs" });
      if (sc === "acquired") pages.push({ url: `https://news.example.com/${domain}/acquired`, sourceType: "news", publishedAt: daysAgo(40), title: `${companyName} acquired by MegaCorp`, text: "acquired" });
      // Finding no negative news is still an answer (recorded by the LLM step).
      return pages;
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
  async extractEvidence(pages: ResearchPage[], key: string): Promise<ExtractedEvidence[]> {
    if (key === "negative" && pages.length === 0) return [];
    return pages.map((p) => {
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
    });
  }

  async infer(facts: { id: string; key: string; claim: string }[]) {
    const out: { text: string; basedOn: string[] }[] = [];
    const triggers = facts.filter((f) => f.key === "trigger");
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
    const lead = input.facts.find((f) => f.key === "trigger") ?? input.facts[0];
    const support = input.facts.find((f) => f.key === "owner_function" && f.id !== lead?.id);
    const hi = input.firstName ? `Hi ${input.firstName},` : "Hi,";
    const claims: { text: string; factIds: string[] }[] = [];
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
    // Approved seller collateral (about the seller, not the prospect).
    lines.push("", input.stepOrder === 1 ? `${input.seller.pitch}\n\n${input.seller.cta}` : `Following up on my last note — ${input.instruction.toLowerCase()}. ${input.seller.pitch}`);
    lines.push("", `${input.sender.name}`, `${input.sender.company} · ${input.sender.address}`, "", "Reply \"unsubscribe\" and I won't email again.");
    return {
      subject: input.stepOrder === 1 ? `${input.company} + first-time-right partner data` : `Re: ${input.company} + first-time-right partner data`,
      body: lines.join("\n"),
      angle: lead?.key ?? null,
      claims,
    };
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
  };
}

export type MockAdapters = ReturnType<typeof createMockAdapters>;
