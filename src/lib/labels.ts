// One place that turns stored codes (c_level, email_open, mock-provider) into words people read.

const WORDS: Record<string, string> = {
  c_level: "C-level", vp: "VP", vp_level: "VP", ceo: "CEO", cfo: "CFO", cio: "CIO", cto: "CTO", it: "IT", ai: "AI", crm: "CRM", erp: "ERP", sap: "SAP",
  decision_maker: "Decision maker", economic_buyer: "Economic buyer", do_not_contact: "Do not contact", in_sequence: "In sequence", handed_off: "Handed off",
  email_open: "Email opened", email_click: "Link clicked", email_reply: "Email reply", email_bounce: "Email bounced", web_visit: "Website visit",
  "mock-provider": "Sample data", mock: "Sample data", email_provider: "Email provider", linkedin_manual: "Logged by the team", csv: "CSV import",
  not_interested: "Not interested", needs_human: "Needs a person", out_of_office: "Out of office",
};

/** "decision_maker" → "Decision maker"; unknown codes get spaces and a capital first letter. Empty stays empty. */
export function humanize(code: string): string;
export function humanize(code: string | null | undefined): string | undefined;
export function humanize(code: string | null | undefined): string | undefined {
  if (code == null || code === "") return undefined;
  const known = WORDS[code] ?? WORDS[code.toLowerCase()];
  if (known) return known;
  const s = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The person page's stage tile: the LinkedIn journey stage, else "Email only" once an email has gone out. */
export function personStage(journeyStage: string | null, emailsSent: number) {
  return journeyStage ?? (emailsSent > 0 ? "Email only" : "Not contacted yet");
}
