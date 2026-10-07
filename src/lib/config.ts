// Every threshold the pipeline uses. This replaces pipeline.yaml from the v1 spec.
// Change values here; stages and gates read nothing hard-coded.

export const CONFIG = {
  // Ideal customer profile, personas, triggers and messaging live in the seller
  // profile (src/lib/seller). This file only holds pipeline mechanics.

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
    maxQuestions: 10,
    // Questions come from the active seller profile (seller().researchQuestions).
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
    /** Brain synthesis (account brief, research plan) — a few thousand tokens on gpt-4o-mini. */
    llmBrain: 0.004,
    /** Approximate cost of one web search per engine (paid tiers). */
    search: { exa: 0.01, tavily: 0.008, serp: 0.015, mock: 0 } as Record<string, number>,
  },

  brain: {
    /** A question already searched for an account within this window is served from cache. */
    searchCacheDays: 7,
    /** Below this many examples a rate is not treated as a finding. */
    minSample: 10,
    /** Regenerate the "what works" summary when the latest is older than this. */
    insightEveryDays: 7,
    /** How many learnings are passed to the draft writer as style advice. */
    learningsInDrafts: 3,
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
    // Manch's GCC and SE Asia markets — B2B outreach bases to confirm with counsel.
    AE: "UAE PDPL (Federal Decree-Law 45/2021) — B2B legitimate business contact, opt-out honoured (confirm with counsel)",
    SA: "Saudi PDPL — B2B legitimate interest, opt-out honoured (confirm with counsel)",
    QA: "Qatar PDPPL (Law 13/2016) — B2B legitimate purpose, opt-out honoured (confirm with counsel)",
    BH: "Bahrain PDPL (Law 30/2018) — B2B legitimate interest (confirm with counsel)",
    OM: "Oman PDPL (Royal Decree 6/2022) — B2B legitimate interest (confirm with counsel)",
    MY: "Malaysia PDPA 2010 — business contact, opt-out honoured (confirm with counsel)",
    ID: "Indonesia PDP Law 27/2022 — legitimate interest (confirm with counsel)",
    PH: "Philippines Data Privacy Act 2012 — legitimate interest (confirm with counsel)",
  } as Record<string, string>,

  euCountries: ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"],

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
