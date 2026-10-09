// Seller profile: Manch Technologies — the company running ABM on this platform.
// Everything the pipeline needs to judge fit, plan research, map buying groups
// and write outreach comes from here. Sources are listed in docs/SELLER-MANCH.md.
// To onboard another seller later, add a profile with the same shape and switch
// ACTIVE_SELLER in src/lib/seller/index.ts.

import type { SellerProfile } from "./types";
import { MANCH_WRITING } from "./manch-writing";

export const MANCH: SellerProfile = {
  id: "manch",
  name: "Manch Technologies",
  website: "https://manchtech.com/en/",
  hq: "Bengaluru, India",
  founded: 2017,
  summary:
    "Agentic-AI, no-code platform for enterprise process orchestration and Master Data Management (MDM). Enterprises use it to onboard, verify and govern data about external parties — distributors, retailers, vendors, suppliers, customers, gig workers — with real-time API validation (PAN, GSTIN, bank, Aadhaar/eKYC, CIN), eSign and governed workflows that feed ERP systems.",
  positioning:
    "First-time-right external and master data: business users describe a process, Manch agents configure, test and deploy it, and every record is validated at the point of entry before it reaches SAP/ERP.",

  products: [
    { name: "Manch Agentic AI", what: "Agents capture a process from plain language, configure it, test and certify it, deploy it, and keep learning — 5–15× faster process configuration, with business users in control." },
    { name: "Manch MDM", what: "Central repository for customer, vendor, partner, product and material master data with AI duplicate detection, 360° view and a GRC engine for periodic and legacy data checks." },
    { name: "Process Configurator", what: "Drag-and-drop, zero-code workflows for multi-party approvals, contracts, asset tracking, compliance and onboarding, with SLAs and escalations." },
    { name: "Digital Onboarding", what: "Pre-built onboarding for partners, distributors, vendors, employees and gig workers with eKYC, Video KYC, eSign and consent." },
    { name: "Verification APIs", what: "Real-time checks for PAN, GSTIN, bank account, Aadhaar, driving licence, CIN, mobile and email; 100+ system integrations; OCR, face match, document classification and anomaly detection." },
  ],

  useCases: [
    { key: "distributor_onboarding", name: "Distributor & retailer lifecycle", pains: "Slow, paper-heavy distributor/retailer onboarding; wrong GST/bank data reaching SAP; channel expansion bottlenecks", outcome: "Partner onboarding from 7 days to 7 hours with validated data" },
    { key: "vendor_onboarding", name: "Vendor & supplier onboarding", pains: "Vendor master duplicates, failed payments from bad bank details, GST mismatches, audit findings", outcome: "First-time-right vendor master with PAN/GSTIN/bank verified at entry" },
    { key: "customer_master", name: "Customer master data", pains: "Multiple legacy MDM tools, inconsistent customer records across plants/regions", outcome: "One governed customer master with statutory controls" },
    { key: "gig_onboarding", name: "Gig & field workforce onboarding", pains: "Onboarding thousands of riders/agents/sellers quickly with KYC and consent", outcome: "Real-time registration velocity with automated compliance checks" },
    { key: "regulated_kyc", name: "Regulated onboarding (KYC)", pains: "Regulatory KYC/consent requirements, manual verification, compliance risk", outcome: "Compliant, paperless onboarding with full audit trail" },
    { key: "product_material_master", name: "Product & material master", pains: "Messy SKU/material data slowing launches and procurement", outcome: "Governed product and material masters ready for AI and analytics" },
  ],

  proofPoints: [
    { text: "30M+ business transactions processed and 300+ configurable enterprise processes live", source: "manchtech.com/en" },
    { text: "Partner onboarding time cut from 7 days to 7 hours", source: "manchtech.com/en" },
    { text: "Typical go-live in 4–8 weeks on pre-built workflows", source: "manchtech.com/en" },
    { text: "A large beverage bottler replaced multiple legacy MDM tools and digitised customer onboarding with real-time API validation", source: "Manch HCCB case study" },
    { text: "A food-delivery network automated partner registration and verification, removing manual compliance checks", source: "Manch case study" },
  ],

  customers: [
    { name: "Hindustan Coca-Cola Beverages", story: "Replaced multiple legacy MDM solutions; digitised complex customer onboarding with real-time, API-based statutory validations.", publicReference: true },
    { name: "Food delivery network (unnamed)", story: "Automated partner onboarding and verification to accelerate partner time-to-revenue.", publicReference: false },
  ],

  competitors: [
    { name: "Informatica MDM", category: "mdm", angle: "Heavy, specialist-led implementations; Manch is no-code and live in weeks with validation built in" },
    { name: "Reltio", category: "mdm", angle: "Strong core MDM but onboarding workflows and India statutory checks need extra build" },
    { name: "SAP MDG", category: "mdm", angle: "Governs inside SAP; Manch captures and validates external-party data before it reaches SAP" },
    { name: "Talend / Boomi", category: "integration", angle: "Move and clean data after the fact; Manch stops bad data at the point of entry" },
    { name: "Appian / Pega", category: "workflow", angle: "General BPM needs developers; Manch agents configure processes from plain language" },
    { name: "Microsoft Power Apps / Mendix / OutSystems", category: "lowcode", angle: "Build-it-yourself apps; Manch ships verification, MDM and onboarding out of the box" },
    { name: "Signzy / IDfy / Leegality / eMudhra", category: "kyc_esign", angle: "Point verification or eSign tools; Manch orchestrates them inside governed master-data workflows" },
  ],

  icp: {
    // Industries with large external-party networks (distributors, vendors, sellers, gig workers).
    industries: [
      { key: "fmcg", label: "FMCG / CPG & beverages", tier: "primary", match: ["fmcg", "cpg", "consumer goods", "consumer packaged", "beverage", "food and beverage", "food & beverage", "personal care", "foods"], partnerIntensity: 1, useCases: ["distributor_onboarding", "customer_master", "vendor_onboarding"] },
      { key: "manufacturing", label: "Manufacturing & industrial", tier: "primary", match: ["manufacturing", "industrial", "automotive", "auto components", "chemicals", "steel", "cement", "electrical", "engineering goods", "building materials", "paints"], partnerIntensity: 0.9, useCases: ["vendor_onboarding", "distributor_onboarding", "product_material_master"] },
      { key: "ecommerce", label: "E-commerce, quick commerce & marketplaces", tier: "primary", match: ["ecommerce", "e-commerce", "quick commerce", "marketplace", "food delivery", "online retail", "d2c"], partnerIntensity: 1, useCases: ["gig_onboarding", "vendor_onboarding"] },
      { key: "fintech", label: "Fintech, NBFC & lending", tier: "primary", match: ["fintech", "nbfc", "lending", "bank", "banking", "financial services", "insurance", "microfinance", "payments", "broking"], partnerIntensity: 0.7, useCases: ["regulated_kyc", "distributor_onboarding"] },
      { key: "pharma", label: "Pharma & healthcare distribution", tier: "secondary", match: ["pharma", "pharmaceutical", "healthcare", "medical devices", "life sciences"], partnerIntensity: 0.8, useCases: ["distributor_onboarding", "vendor_onboarding"] },
      { key: "logistics", label: "Logistics & mobility", tier: "secondary", match: ["logistics", "supply chain", "transport", "mobility", "courier", "shipping"], partnerIntensity: 0.8, useCases: ["gig_onboarding", "vendor_onboarding"] },
      { key: "retail", label: "Retail chains & franchises", tier: "secondary", match: ["retail", "franchise", "consumer durables", "electronics retail", "apparel"], partnerIntensity: 0.7, useCases: ["vendor_onboarding", "distributor_onboarding"] },
      { key: "telecom", label: "Telecom & energy distribution", tier: "secondary", match: ["telecom", "telecommunications", "energy", "oil and gas", "utilities", "power"], partnerIntensity: 0.6, useCases: ["distributor_onboarding", "regulated_kyc"] },
    ],
    employees: { sweetSpot: 10000, mid: 5001, min: 5001 },
    geos: {
      primary: ["IN"],
      secondary: ["AE", "SA", "QA", "OM", "KW", "BH", "US", "GB", "SG", "MY", "ID", "PH", "AU"],
    },
    tech: {
      erp: ["sap", "s/4hana", "s4hana", "sap ecc", "oracle", "oracle ebs", "netsuite", "microsoft dynamics", "dynamics 365", "infor", "tally"],
      incumbents: ["informatica", "reltio", "sap mdg", "stibo", "profisee", "tibco ebx", "semarchy", "talend"],
      workflow: ["appian", "pega", "power apps", "mendix", "outsystems", "servicenow"],
    },
    weights: { industry: 35, size: 25, geography: 15, partnerNetwork: 15, techStack: 10 },
    // Manch's targeting rule: companies located in India with more than 5,000 employees.
    mustHave: { countries: ["IN"], minEmployees: 5001 },
    // No target industries for now: any industry qualifies; research and buying signals decide.
    industryMode: "any",
    // Tier by size: 50,000+ = T1, 15,000+ = T2, else T3. Hot buying signals upgrade to T1.
    tierBySize: { T1: 50000, T2: 15000 },
  },

  personas: [
    { role: "decision_maker", functions: ["data", "it"], titles: ["cio", "chief information officer", "cdo", "chief data officer", "chief digital officer", "cto", "head of it", "it head", "vp it", "head of digital", "digital transformation"], why: "Owns the platform decision and master-data strategy" },
    { role: "decision_maker", functions: ["finance", "procurement"], titles: ["cfo", "chief financial officer", "cpo", "chief procurement officer", "head of procurement", "vp procurement", "director procurement"], why: "Owns vendor master quality, payments risk and audit outcomes" },
    { role: "decision_maker", functions: ["sales"], titles: ["head of distribution", "vp sales operations", "chief sales officer", "head of channel", "head of trade marketing"], why: "Owns distributor/retailer onboarding speed and channel expansion" },
    { role: "champion", functions: ["data", "it"], titles: ["master data", "mdm", "data governance", "head of data", "sap coe", "sap lead", "erp lead", "business process excellence", "process excellence", "automation lead", "enterprise architect"], why: "Feels the data-quality pain daily and runs the implementation" },
    { role: "champion", functions: ["finance", "procurement", "operations", "sales"], titles: ["procurement operations", "vendor management", "supplier onboarding", "p2p", "accounts payable", "sales operations manager", "distributor onboarding", "partner onboarding", "shared services", "gbs"], why: "Runs the onboarding process Manch automates" },
    { role: "influencer", functions: ["compliance", "security", "legal"], titles: ["compliance", "risk", "kyc", "audit", "ciso", "legal", "company secretary"], why: "Must sign off on KYC, consent and audit controls" },
    { role: "budget_owner", functions: ["finance"], titles: ["controller", "finance director", "vp finance", "head of finance"], why: "Approves spend" },
  ],

  triggers: [
    { key: "erp_migration", label: "ERP migration or upgrade (e.g. SAP S/4HANA)", keywords: ["s/4hana", "s4hana", "sap migration", "erp migration", "erp upgrade", "go-live", "rise with sap"], why: "Master data must be cleaned and governed before cut-over" },
    { key: "channel_expansion", label: "Distributor / retail / seller network expansion", keywords: ["distributor", "dealer", "retail outlets", "expand distribution", "new markets", "rural reach", "seller onboarding"], why: "Onboarding volume spikes; manual KYC and GST checks break" },
    { key: "workforce_scale", label: "Rapid gig / field workforce hiring", keywords: ["riders", "delivery partners", "field force", "gig workers", "hiring thousands", "agents"], why: "Needs high-velocity onboarding with KYC and consent" },
    { key: "compliance_mandate", label: "New compliance or audit pressure", keywords: ["gst", "e-invoicing", "rbi", "kyc", "dpdp", "audit", "regulator", "penalty", "notice"], why: "Statutory validation at entry becomes mandatory" },
    { key: "mdm_replacement", label: "Legacy MDM or data-quality programme", keywords: ["master data", "mdm", "data governance", "data quality", "duplicate vendors", "golden record"], why: "Active budget for replacing or modernising MDM" },
    { key: "ma_integration", label: "Merger, acquisition or ERP consolidation", keywords: ["acquisition", "merger", "acquired", "integration of", "consolidation"], why: "Two sets of vendor/customer masters must be merged" },
    { key: "ai_readiness", label: "AI / automation initiative", keywords: ["ai", "automation", "agentic", "genai", "digital transformation"], why: "Clean, governed master data is a prerequisite for AI" },
    { key: "funding_growth", label: "Funding or IPO-driven scale-up", keywords: ["raised", "series", "ipo", "funding"], why: "Growth plans multiply partners and vendors to onboard" },
  ],

  negativeSignals: [
    "Signed a multi-year Informatica/Reltio/SAP MDG programme in the last 12 months",
    "Fewer than ~200 employees or no meaningful partner/vendor network",
    "Layoffs or hiring freeze in the last 90 days",
    "Acquired, insolvent, or under strategic review",
  ],

  researchQuestions: [
    { key: "trigger", label: "Recent trigger", trigger: true, question: "What changed recently that creates a master-data or onboarding need (ERP/S4HANA migration, distributor or seller expansion, gig hiring surge, new compliance mandate, M&A, AI programme)?", importance: "high",
      search: { terms: "(SAP S/4HANA OR ERP migration OR distributors OR dealer network OR expansion OR acquisition OR funding OR digital transformation OR vendor onboarding)", days: 120, news: true } },
    { key: "owner_function", label: "Who owns onboarding", question: "Which function owns partner/vendor onboarding and master data (IT/data, procurement, finance, sales operations)?", importance: "high",
      search: { terms: "careers (master data OR procurement OR vendor onboarding OR distributor onboarding OR SAP)", days: 365, news: false },
      extract: "Which function owns partner/vendor onboarding or master data." },
    { key: "negative", label: "Negative news", question: "Any layoffs, hiring freeze, acquisition, insolvency, or a recently signed competing MDM programme?", importance: "high" },
    { key: "tooling", label: "Systems in use", question: "Which ERP, MDM, workflow and KYC/eSign tools do they use today?", importance: "medium",
      search: { terms: '(SAP OR Oracle OR "Microsoft Dynamics" OR Informatica OR "master data management")', days: 730, news: false },
      extract: "ERP, MDM, workflow, KYC or eSign tools the company uses. value = comma-separated tool names." },
    { key: "partner_network", label: "Partner network size", question: "How large is their external network (distributors, retailers, vendors, sellers, gig workers) and how fast is it growing?", importance: "medium",
      search: { terms: "(distributors OR dealers OR retail outlets OR suppliers OR vendors OR delivery partners)", days: 730, news: false },
      extract: "Size of the external network (distributors, dealers, retailers, vendors, delivery partners). value = the number only, digits." },
    { key: "culture", label: "Culture", question: "What is the company culture like?", importance: "low" },
    // Deep dive — T1 companies, and any company where someone has engaged on LinkedIn.
    { key: "erp_program", label: "ERP / MDM programme", trigger: true, question: "Is an ERP / SAP S/4HANA, MDM or master-data programme underway — scope, timeline, implementation partner?", importance: "medium", depth: "deep",
      search: { terms: '("SAP S/4HANA" OR "ERP implementation" OR "master data" OR MDM OR "digital transformation") partner rollout', days: 365, news: true },
      extract: "An ERP / SAP S/4HANA, MDM or master-data programme: what, scope, timeline, implementation partner. One item per programme." },
    { key: "expansion", label: "Expansion", trigger: true, question: "Are they adding distributors, dealers, retailers, plants, markets, sellers or delivery partners?", importance: "medium", depth: "deep",
      search: { terms: '(expansion OR "new plant" OR distributors OR dealers OR "new markets" OR sellers)', days: 180, news: true },
      extract: "Expansion of distributors, dealers, retailers, plants, markets, sellers or delivery partners. One item per announcement; include numbers when stated." },
    { key: "leadership", label: "Leadership change", trigger: true, question: "Did they appoint a new CIO, CDO, CPO, CFO or head of master data / procurement in the last 12 months?", importance: "medium", depth: "deep",
      search: { terms: 'appoints (CIO OR CDO OR "Chief Digital Officer" OR CPO OR CFO OR "head of procurement")', days: 365, news: true },
      extract: "A new CIO, CDO, CPO, CFO, head of master data or head of procurement appointed. Claim = who, which role, when." },
    { key: "compliance", label: "Compliance pressure", question: "What regulatory or audit pressure applies — GST e-invoicing, RBI KYC, DPDP, SOX, supplier audits?", importance: "medium", depth: "deep",
      search: { terms: '(GST e-invoicing OR KYC OR "data protection" OR DPDP OR audit OR compliance)', days: 365, news: false },
      extract: "Regulatory or audit pressure the company faces (GST e-invoicing, RBI KYC, DPDP, SOX, supplier audits)." },
  ],


  messaging: {
    cta: "Worth a 20-minute call to see how agents configure this in weeks, not quarters?",
    byUseCase: {
      distributor_onboarding: "Teams at that stage usually find distributor and retailer onboarding slows down — GST, PAN and bank details checked by hand before anything reaches SAP. Manch validates them at the point of entry and has cut partner onboarding from 7 days to 7 hours.",
      vendor_onboarding: "That usually puts pressure on the vendor master — duplicates, GST mismatches and failed payments from bad bank details. Manch verifies PAN, GSTIN and bank accounts in real time so the vendor master is right the first time.",
      customer_master: "One large beverage bottler in a similar spot replaced several legacy MDM tools with Manch and now validates every new customer in real time before it reaches the ERP.",
      gig_onboarding: "Onboarding riders, agents or sellers at that pace is where manual KYC and consent checks break. Manch automates registration and verification so new partners go live the same day.",
      regulated_kyc: "That raises the bar on KYC and consent. Manch runs paperless, compliant onboarding with eKYC, Video KYC and eSign — with a full audit trail.",
      product_material_master: "Clean product and material masters tend to become the bottleneck for launches and procurement. Manch governs them with AI duplicate detection and approvals.",
    },
    default: "Manch gives business teams governed, validated master data and onboarding workflows — configured by AI agents and live in 4–8 weeks.",
  },

  sender: {
    company: "Manch Technologies",
    name: "Team Manch",
    // TODO(seller): replace with the full registered postal address (required in every email).
    address: "Bengaluru, Karnataka, India",
  },

  tone: ["Plain, specific and short: under 120 words", "Peer-to-peer, never salesy; no hype words", "One idea per email, one clear question at the end"],

  bannedClaims: [
    "guaranteed results or guaranteed ROI",
    "named customer results that are not public references",
    "being the only or the best platform",
    "claims about the prospect's internal problems stated as fact",
    "pricing or discounts",
  ],

  autonomy: "review_all",

  ruleHints: {
    techHypothesis: "An existing {tech} means validated master data must reach it cleanly — Manch integrates rather than replaces it",
    toolingPain: "Fragmented or manual master data across {tools}",
  },

  writing: MANCH_WRITING,
};
