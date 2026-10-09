// Where the writing knowledge comes from. Every playbook rule, persona note, market
// fact and example cites one or more of these ids, so a reviewer can check the basis
// and replace a rule when better (or our own) data arrives.
//
// Findings are paraphrased; nothing here is copied from the sources.

export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** When the data was collected or published. */
  date: string;
  /** What it is based on (dataset or survey size). */
  basis: string;
  /** The findings we rely on, in our own words. */
  findings: string[];
}

export const SOURCES: Record<string, Source> = {
  hunter_2026: {
    id: "hunter_2026",
    title: "The State of Email Outreach 2026",
    publisher: "Hunter",
    url: "https://hunter.io/the-state-of-cold-email",
    date: "2026 (2025 data)",
    basis: "31M cold emails sent by Hunter users in 2025, plus surveys of senders and decision makers",
    findings: [
      "Average reply rate about 4.5%; sales outreach about 3%.",
      "Small, targeted sequences (21–50 recipients) replied at 6.2% vs 2.4% for 500+.",
      "Contacting 1–2 people per company replied better (5.1%) than 3+ (3.5%).",
      "Three messages in total roughly doubled replies vs one; the first message still drew most replies; four or more messages did not help further.",
      "Two personalised details lifted reply rate from 3.6% to 5.6%; manually edited emails beat fully automated ones (5.2% vs 4.4%).",
      "Subject lines of 5–6 words did best; 'Quick question' underperformed.",
      "Emails of roughly 61–80 words were among the best performers.",
      "Open tracking was associated with lower reply rates (4.4% vs 7.4% without).",
      "Survey: the top complaints are emails that feel too sales-focused (65%) or irrelevant (61%); most decision makers dislike AI-sounding emails; 67% are more likely to reply when public information is used well; half prefer LinkedIn to email for outreach.",
    ],
  },
  saleshandy_2026: {
    id: "saleshandy_2026",
    title: "Cold email statistics (53M emails analysed)",
    publisher: "Saleshandy",
    url: "https://saleshandy.com/blog/cold-email-statistics/",
    date: "2026",
    basis: "About 30M cold emails and 40k sequences sent July–October 2026",
    findings: [
      "Average reply rate about 4.5%; top 5% of campaigns reach 11–15%.",
      "Follow-ups produce a large share of replies; the first follow-up contributes most, later ones less each time.",
      "One soft, interest-based ask got far more positive replies than a hard meeting request; several asks did worst.",
      "Subject lines of 5–7 words (about 36–50 characters) opened best.",
      "Guidance: keep a first touch under 100 words — one problem, one value, one ask. Tuesday–Thursday sends did best; in APAC, afternoons outperformed mornings.",
    ],
  },
  woodpecker_2026: {
    id: "woodpecker_2026",
    title: "Cold Email Benchmark",
    publisher: "Woodpecker",
    url: "https://woodpecker.co/cold-email-benchmarks/",
    date: "Q4 2025 data, updated 2026",
    basis: "56,614 campaigns (reply rate); sequence-position data from 1,020 companies",
    findings: [
      "Median reply rate 1.5% — most outreach gets no answer, so relevance matters more than volume.",
      "Each later email in a 4–6 step sequence replies less than the one before (1.0% → 0.9% → 0.6% → 0.5% → 0.3%).",
      "Smaller lists reply better: 0–50 prospects 2.7% median vs 0.5% for 10,000+.",
      "Weekend sends reply about a third less than weekday sends.",
    ],
  },
  gong_cta: {
    id: "gong_cta",
    title: "The cold email CTA that books more meetings",
    publisher: "Gong Labs",
    url: "https://www.gong.io/blog/this-surprising-cold-email-cta-will-help-you-book-a-lot-more-meetings",
    date: "Gong Labs research",
    basis: "304,174 emails; outcome = meeting booked within 10 days",
    findings: [
      "In cold emails, asking about interest ('worth exploring?') beat proposing a specific meeting time — sell the conversation, not the meeting.",
      "Once a buyer is in an active deal the pattern flips: a specific time works best.",
    ],
  },
  gong_stats: {
    id: "gong_stats",
    title: "Cold email stats",
    publisher: "Gong",
    url: "https://www.gong.io/blog/cold-email-stats",
    date: "Gong Labs research",
    basis: "Millions of anonymised cold emails from Gong customers",
    findings: [
      "Emails of roughly 30–150 words booked meetings better than very short ones when personalised.",
      "ROI language reduced success; asking for 'thoughts' raised replies but lowered meetings booked.",
      "A brief courteous greeting ('hope all is well') was associated with more meetings booked — correlation, not proof.",
      "Guilt-trip follow-ups ('I never heard back') raised replies but lowered meetings booked.",
    ],
  },
  expandi_li_2026: {
    id: "expandi_li_2026",
    title: "LinkedIn Outreach Benchmarks 2026",
    publisher: "Expandi",
    url: "https://expandi.io/blog/linkedin-outreach-benchmarks-2026/",
    date: "May 2025 – April 2026",
    basis: "13.2M connection requests, 6.7M messages, 13,302 accounts",
    findings: [
      "About 28.5% of connection requests are accepted; replies to the note itself are about 3% and falling.",
      "Messages after connecting get about 10% replies — the conversation, not the request, is where replies come from.",
      "Software senders sit slightly below average (27.5% acceptance, 8.8% message replies).",
    ],
  },
  linkedin_note_limits: {
    id: "linkedin_note_limits",
    title: "Connection notes in multichannel",
    publisher: "Salesforge help centre",
    url: "https://help.salesforge.ai/en/articles/10333605-connection-notes-in-multichannel",
    date: "2026",
    basis: "Product documentation",
    findings: ["Free LinkedIn accounts allow connection notes up to 200 characters (with a monthly cap on notes); Premium allows 300."],
  },
  gartner_buyers_2025: {
    id: "gartner_buyers_2025",
    title: "61% of B2B buyers prefer a rep-free buying experience",
    publisher: "Gartner",
    url: "https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-sales-survey-finds-61-percent-of-b2b-buyers-prefer-a-rep-free-buying-experience",
    date: "June 2025 (survey Aug–Sep 2024)",
    basis: "Survey of 632 B2B buyers",
    findings: [
      "61% of B2B buyers prefer to buy without a sales rep; 73% actively avoid suppliers who send irrelevant outreach.",
      "Buyers want sellers for judgement in context — is this right for us — not for generic information they can read online.",
    ],
  },
  bain_india_2026: {
    id: "bain_india_2026",
    title: "India Enterprise Technology Report 2026",
    publisher: "Bain & Company",
    url: "https://www.bain.com/insights/india-enterprise-technology-report-2026/",
    date: "May 2026",
    basis: "Interviews and surveys of 250+ CIOs, CDOs, CAIOs and CXOs in India",
    findings: [
      "About 90% of Indian technology leaders say their data foundations are weak and not ready to scale.",
      "IT budgets are rising 6–8% in 2026; data modernisation and AI take about 30% of capex, core application modernisation about 25%.",
      "Leaders report 'PoC fatigue' — AI pilots without proven ROI — and three in four cite misalignment between business and IT goals.",
      "Priorities are increasingly set jointly by business, technology, risk and compliance teams, ranked by risk-adjusted value.",
    ],
  },
  deloitte_cpo_2025: {
    id: "deloitte_cpo_2025",
    title: "2025 Global Chief Procurement Officer Survey",
    publisher: "Deloitte",
    url: "https://deloitte.com/us/en/about/press-room/2025-chief-procurement-officer-survey.html",
    date: "August 2025",
    basis: "250+ CPOs in 40 countries",
    findings: [
      "CPOs are under pressure from rising costs, regulation and supply disruption; risk management and talent are top priorities.",
      "Biggest barriers: siloed ways of working (57%), competing priorities (46%), capability to execute (40%).",
      "Top risk responses: alternative sources (74%), supply-chain visibility (64%), better supplier information sharing (61%).",
      "Leading teams put up to 24% of procurement budget into technology and report about 3.2x return on GenAI.",
    ],
  },
  deloitte_cfo_india_2025: {
    id: "deloitte_cfo_india_2025",
    title: "Asia Pacific CFO Survey 2025 — India insights",
    publisher: "Deloitte",
    url: "https://www.deloitte.com/in/en/services/consulting/perspectives/asia-pacific-cfo-survey-2025-india-insights",
    date: "2025",
    basis: "469 CFOs across Asia Pacific (India cut reported separately for some questions)",
    findings: [
      "67% of Indian CFOs prioritise growing revenue over cutting cost; 69% are investing in upskilling for new technology.",
      "Indian CFOs are raising investment in digital and automation and expect deal activity (M&A, alliances) to grow.",
    ],
  },
  afp_fraud_2025: {
    id: "afp_fraud_2025",
    title: "2025 AFP Payments Fraud and Control Survey",
    publisher: "Association for Financial Professionals",
    url: "https://www.financialprofessionals.org/about/learn-more/press-releases/Details/survey-79-percent-of-organizations-were-victims-of-attempted-or-actual-payments-fraud-activity-in-2024",
    date: "Survey January 2025 (2024 data)",
    basis: "521 corporate finance practitioners",
    findings: [
      "79% of organisations faced attempted or actual payments fraud in 2024.",
      "Vendor impersonation was reported by 45% of respondents, up 11 points; business email compromise was the top route (63%).",
    ],
  },
  parle_sap_2025: {
    id: "parle_sap_2025",
    title: "Parle Biscuits — SAP Innovation Awards 2025",
    publisher: "SAP",
    url: "https://www.sap.com/documents/2025/03/14af0814-fb7e-0010-bca6-c68f7e60039b.html",
    date: "March 2025",
    basis: "Public case submission",
    findings: [
      "Parle onboarded 200+ new wholesalers a month with manual KYC and approvals, causing data errors and delays across 8,000+ wholesalers.",
      "After digitising, it reported about 80% faster wholesaler onboarding and about 90% less manual effort.",
    ],
  },
  authbridge_fmcg: {
    id: "authbridge_fmcg",
    title: "Challenges FMCG companies face in onboarding vendors and customers",
    publisher: "AuthBridge",
    url: "https://authbridge.com/authbridge-in-media/what-kind-of-challenges-are-fmcg-companies-facing-in-onboarding-vendors-customers/",
    date: "Undated article",
    basis: "Practitioner commentary (no data)",
    findings: [
      "Partners are often onboarded with too little due diligence and checked only once, at entry.",
      "Partner data sits in disconnected systems, so departments can't see each other's dealings with the same partner.",
      "Typical checks: bank and GST filing, PF/ESIC/GST registrations, court and watchlist records, address proof, KYC/AML.",
    ],
  },
  gstn_einvoice_30d: {
    id: "gstn_einvoice_30d",
    title: "Time limit of 30 days for reporting e-invoices (AATO ≥ ₹10 crore)",
    publisher: "GSTN advisory, summarised by Taxmann",
    url: "https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/",
    date: "Effective 1 April 2025",
    basis: "Government advisory",
    findings: ["Businesses with aggregate turnover of ₹10 crore or more cannot report an e-invoice on the IRP more than 30 days after its date."],
  },
  dpdp_rules_2025: {
    id: "dpdp_rules_2025",
    title: "MeitY notifies final DPDP Rules 2025",
    publisher: "S.S. Rana & Co.",
    url: "https://ssrana.in/articles/meity-notifies-final-digital-personal-data-protection-rules-2025/",
    date: "Rules notified 13 November 2025",
    basis: "Legal analysis of the gazette notification",
    findings: [
      "Most obligations on data fiduciaries — notice and consent, security safeguards, rights requests, retention — apply from 13 May 2027.",
      "Breaches must be reported within 72 hours; processing logs kept for at least a year.",
    ],
  },
  tmf_india_culture: {
    id: "tmf_india_culture",
    title: "Cultural considerations in India",
    publisher: "TMF Group",
    url: "https://www.tmf-group.com/en/news-insights/articles/2018/march/cultural-considerations-in-india/",
    date: "Article (updated)",
    basis: "Practitioner guidance",
    findings: [
      "Start slightly more formal than needed; use titles and surnames until invited otherwise.",
      "Decisions sit with senior leadership: identify deciders, influencers and executors, and secure a senior sponsor.",
      "A direct 'no' is often avoided — 'we'll try', 'it may be difficult' or repeated deferrals usually mean no; respond by finding the constraint and offering a smaller pilot.",
      "Confirm decisions and next steps in writing.",
    ],
  },
};

export function sourceList(ids: string[]): Source[] {
  return ids.map((id) => SOURCES[id]).filter((s): s is Source => Boolean(s));
}
