// Metric definition registry. Every number the app shows as a headline (Home, Today,
// Overview, Analytics) is defined once here: its name, what it counts, where it links and
// how it is computed in words. Screens take the label and definition from here, so the
// same number never means two things on two pages.

export interface MetricDef {
  key: string;
  label: string;
  /** What is counted, in plain words (shown as the tooltip). */
  define: string;
  /** Where the number links; null when there is no honest destination yet. */
  href: string | null;
  unit?: "count" | "usd" | "percent";
}

const defs = [
  // Home KPIs
  { key: "qualified", label: "Qualified companies", define: "Passed the targeting rule and fit check, not ruled out", href: "/accounts" },
  { key: "engaged_groups", label: "Engaged buying groups", define: "At least one person replied, engaged after our email, or is in a logged LinkedIn conversation", href: "/accounts/coverage" },
  { key: "open_opps", label: "Open opportunities", define: "Opportunities not yet won or lost. Value only where a person entered it", href: "/crm/opportunities" },
  { key: "at_risk", label: "At risk", define: "Companies with outreach paused (objection, not now) or research stopped on an error that retries didn't fix", href: "#attention" },
  { key: "emails_to_approve", label: "Emails to approve", define: "Drafts that passed every check and wait for a person", href: "/review" },
  { key: "overdue", label: "Overdue", define: "Open tasks past their due date, and hand-offs past the response time", href: "/crm/tasks" },
  // Company flow steps (nested: each counts companies that also passed every step before it)
  { key: "flow_imported", label: "Imported", define: "Every company in the workspace", href: "/accounts" },
  { key: "flow_qualified", label: "Qualified", define: "Passed targeting and fit", href: "/accounts" },
  { key: "flow_researched", label: "Researched", define: "Has a sourced research brief", href: "/accounts" },
  { key: "flow_contactable", label: "Contactable", define: "At least one person passed readiness (verified, lawful, not suppressed)", href: "/accounts/coverage" },
  { key: "flow_contacted", label: "Contacted", define: "An email was delivered, or a LinkedIn step was logged", href: "/outreach" },
  { key: "flow_engaged", label: "Engaged", define: "A person replied or engaged (LinkedIn: only what was logged)", href: "/accounts/coverage" },
  { key: "flow_handoff", label: "Handed to sales", define: "A hand-off was created", href: "/handoffs" },
  { key: "flow_opportunity", label: "Opportunity", define: "An opportunity record exists", href: "/crm/opportunities" },
  // Today
  { key: "decisions_today", label: "Decisions", define: "Open decisions that aren't email approvals (identity, blockers, conflicts). Today lists the 5 oldest; all are in Approvals", href: "/review" },
  { key: "replies_open", label: "Replies", define: "People who answered and are waiting on us: asked for details, interested, neutral reply or referred us", href: "/people" },
  { key: "followups_due", label: "Follow-ups due", define: "LinkedIn follow-ups whose due date has passed, for companies not ruled out", href: "/people" },
  { key: "hot_companies", label: "Hot companies", define: "Companies whose buying intent is hot: two or more independent signals agree", href: "/accounts?sort=intent" },
  { key: "live_conversations", label: "Live conversations", define: "People who replied or moved further on LinkedIn (details, interest, call or demo)", href: "/people" },
  // Spend: one definition everywhere
  { key: "spend_total", label: "Spend to date", define: "Every cost recorded: AI, web search, paid lookups and verification", href: "/analytics", unit: "usd" },
] as const satisfies readonly MetricDef[];

export type MetricKey = (typeof defs)[number]["key"];
export const METRICS: Record<MetricKey, MetricDef> = Object.fromEntries(defs.map((d) => [d.key, d])) as Record<MetricKey, MetricDef>;
export const metric = (k: MetricKey) => METRICS[k];

/** Ledger kinds that make up "spend to date". */
export const SPEND_KINDS = ["llm", "search", "lookup", "verification"] as const;
