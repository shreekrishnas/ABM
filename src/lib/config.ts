// Every threshold the pipeline uses. This replaces pipeline.yaml from the v1 spec.
// Change values here; stages and gates read nothing hard-coded.

export const CONFIG = {
  icp: {
    industries: ["software", "saas", "fintech", "analytics", "healthtech"],
    employees: { min: 300, max: 2500 },
    countries: ["US", "GB", "DE", "NL", "CA", "IE", "IN"],
    weights: { industry: 40, size: 30, region: 30 },
  },

  fit: {
    floor: 40,
    tiers: { T1: 80, T2: 60 }, // fit >= 80 → T1, >= 60 → T2, else T3
    lostDealCooldownDays: 90,
  },

  priority: {
    // score = fit * fitWeight + (1 - confidence) * gapWeight + intent * intentWeight
    fitWeight: 0.6,
    gapWeight: 25,
    intentWeight: 0.15,
    high: 70,
    medium: 45,
  },

  freshnessDays: {
    email: 180,
    title: 120,
    company: 180,
    trigger: 90,
    negative: 90,
  },

  research: {
    maxQuestions: 6,
    templates: [
      { key: "trigger", question: "What changed recently that creates a reason to talk (funding, launch, hiring, leadership change)?", importance: "high" },
      { key: "owner_function", question: "Which function owns the problem we solve?", importance: "high" },
      { key: "negative", question: "Any layoffs, hiring freeze, acquisition or bankruptcy in the last 90 days?", importance: "high" },
      { key: "tooling", question: "What tools do they use today in our category?", importance: "medium" },
      { key: "size", question: "How large is the team that would use the product?", importance: "medium" },
      { key: "culture", question: "What is the company culture like?", importance: "low" },
    ],
    // Questions whose answer never changes a decision.
    neverChangesDecision: ["culture"],
  },

  readiness: {
    triggerWindowDays: 90,
    minVerifiedTriggers: 1,
    minUsableTriggers: 2,
    weakEvidenceWatchDays: 30,
    negativeWatchDays: 90,
    eligibleRoles: ["decision_maker", "champion"] as const,
  },

  guardrail: { maxAttempts: 3 },

  engagement: {
    points: {
      email_open: 2, // Apple Mail Privacy Protection makes opens unreliable
      email_click: 8,
      email_reply: 50,
      site_visit: 10,
      pricing_visit: 25,
      intent_surge: 20,
      job_change: 15,
      event_attended: 30,
      content_download: 15,
    },
    halfLifeDays: 14,
    stages: { AWARE: 10, ENGAGED: 35, MQA: 70 },
    // Anonymous / unattributed activity counts toward the account score at this weight.
    unattributedWeight: 0.5,
  },

  intent: {
    surgeThreshold: 60, // intent score that pulls a watched account back to research
  },

  sending: {
    perMailboxDailyCap: 40,
    globalDailyCap: 400,
    bounceBreakerPct: 2,
    bounceBreakerMinSends: 50,
  },

  handoff: {
    ackSlaHours: 24,
    retuneMinClosedDeals: 200,
  },

  watch: {
    notNowDays: 60,
    lostDealDays: 90,
  },

  budgetsUsd: { T1: 5, T2: 2, T3: 0.75 } as Record<"T1" | "T2" | "T3", number>,

  costsUsd: {
    paidLookup: 0.1,
    providerCheck: 0.02,
    mailboxVerify: 0.005,
    llmCheap: 0.002,
    llmStrong: 0.03,
  },

  approval: {
    // When false, T3 drafts that pass every automatic check skip human review.
    requireHumanForT3: true,
  },

  // Legal basis by company country. Confirm with counsel before going live.
  lawfulBasis: {
    US: "CAN-SPAM (opt-out)",
    CA: "CASL implied consent (business relevance)",
    GB: "PECR B2B corporate subscriber + UK GDPR legitimate interest",
    IN: "DPDP Act 2023 — legitimate use",
    AU: "Spam Act inferred consent (conspicuous publication)",
    SG: "PDPA business contact exemption",
    EU: "GDPR Art. 6(1)(f) legitimate interest — LIA on file",
  } as Record<string, string>,

  euCountries: ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"],

  sender: {
    name: "ABM Team",
    company: "Your Company",
    address: "100 Market St, San Francisco, CA",
  },

  // Domains treated as personal email providers (identity conflict for B2B).
  personalDomains: ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "proton.me", "protonmail.com", "aol.com"],
} as const;

export type Config = typeof CONFIG;

export const STAGES = [
  { n: 1, id: "data_input", name: "Data Input", cat: "data" },
  { n: 2, id: "clean_normalize", name: "Clean & Normalize", cat: "data" },
  { n: 3, id: "fit_tier", name: "Fit, Tier & Exclusions", cat: "data" },
  { n: 4, id: "identity", name: "Identity Verification", cat: "data" },
  { n: 5, id: "research_plan", name: "Research Plan", cat: "research" },
  { n: 6, id: "account_research", name: "Account Research", cat: "research" },
  { n: 7, id: "account_twin", name: "Evidence & Account Twin", cat: "research" },
  { n: 8, id: "buying_group", name: "Buying Group", cat: "people" },
  { n: 9, id: "enrichment", name: "Contact Enrichment", cat: "people" },
  { n: 10, id: "readiness", name: "Readiness Gate", cat: "outreach" },
  { n: 11, id: "draft_review", name: "Draft & Review", cat: "outreach" },
  { n: 12, id: "sequence_send", name: "Sequence, Send & Measure", cat: "engagement" },
  { n: 13, id: "handoff", name: "Sales Handoff & Recycle", cat: "engagement" },
] as const;

export type StageCat = (typeof STAGES)[number]["cat"];
