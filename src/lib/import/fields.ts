// The predefined import template. Only these columns are accepted and stored;
// anything else in a file is ignored and reported. To accept a new column, add
// it here (and to the database schema) — nothing else needs to change.
//
// Client-safe: no database imports. Used by the browser to preview a file and by
// the server to validate every row.

import { isValidEmail, normalizeCountry, normalizeDomain, normalizeEmail, normalizeLinkedin, normalizePhone } from "@/lib/pipeline/normalize";

export type FieldKey =
  | "company" | "domain" | "industry" | "employees" | "country" | "technologies"
  | "contactName" | "email" | "title" | "phone" | "linkedinUrl" | "titleObservedAt";

export interface ImportField {
  key: FieldKey;
  label: string; // header used in the template
  group: "Company" | "Contact";
  required: boolean;
  aliases: string[]; // other header spellings we accept (lowercase, spaces)
  example: string;
  help: string;
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: "company", label: "Company", group: "Company", required: true, aliases: ["company", "company name", "account", "account name", "organization", "organisation"], example: "Northwind Analytics", help: "Company name" },
  { key: "domain", label: "Domain", group: "Company", required: true, aliases: ["domain", "website", "company domain", "url", "company website"], example: "northwind-analytics.com", help: "Website or domain — the unique key that links weekly uploads to the same account" },
  { key: "industry", label: "Industry", group: "Company", required: false, aliases: ["industry", "sector", "vertical"], example: "analytics", help: "Free text, e.g. saas, fintech" },
  { key: "employees", label: "Employees", group: "Company", required: false, aliases: ["employees", "employee count", "headcount", "company size", "size"], example: "850", help: "Number or range like 200-500" },
  { key: "country", label: "Country", group: "Company", required: false, aliases: ["country", "hq country", "company country"], example: "US", help: "2-letter code (US, GB, IN) or country name" },
  { key: "technologies", label: "Tech Stack", group: "Company", required: false, aliases: ["tech stack", "technologies", "technology", "tech", "software used", "erp", "systems used"], example: "SAP S/4HANA; Informatica", help: "ERP, MDM and workflow tools, separated by ; — used in the fit score" },
  { key: "contactName", label: "Contact Name", group: "Contact", required: false, aliases: ["contact name", "name", "full name", "contact", "person", "prospect", "prospect name"], example: "Asha Mehta", help: "Leave blank for company-only rows" },
  { key: "email", label: "Email", group: "Contact", required: false, aliases: ["email", "work email", "email address", "contact email", "business email"], example: "asha.mehta@northwind-analytics.com", help: "Work email" },
  { key: "title", label: "Job Title", group: "Contact", required: false, aliases: ["job title", "title", "position", "role", "designation"], example: "VP Data", help: "Current title" },
  { key: "phone", label: "Phone", group: "Contact", required: false, aliases: ["phone", "phone number", "mobile", "direct dial", "contact number"], example: "+1 415 555 0134", help: "With country code" },
  { key: "linkedinUrl", label: "LinkedIn URL", group: "Contact", required: false, aliases: ["linkedin url", "linkedin", "linkedin profile"], example: "https://www.linkedin.com/in/asha-mehta", help: "Profile URL (matched, never scraped)" },
  { key: "titleObservedAt", label: "Title Date", group: "Contact", required: false, aliases: ["title date", "title observed at", "title observed", "last verified"], example: "2026-09-15", help: "When the title was last known true (YYYY-MM-DD)" },
];

// "contactName" → "contact name", "Work_Email" → "work email"
const norm = (h: string) => h.trim().replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

export interface HeaderAnalysis {
  /** original header → field key */
  mapping: Record<string, FieldKey>;
  recognized: { header: string; field: ImportField }[];
  ignored: string[];
  missingRequired: ImportField[];
  duplicates: string[];
}

export function analyzeHeaders(headers: string[]): HeaderAnalysis {
  const mapping: Record<string, FieldKey> = {};
  const recognized: HeaderAnalysis["recognized"] = [];
  const ignored: string[] = [];
  const duplicates: string[] = [];
  const used = new Set<FieldKey>();
  for (const h of headers) {
    if (!h || !h.trim()) continue;
    const n = norm(h);
    const field = IMPORT_FIELDS.find((f) => norm(f.label) === n || f.aliases.includes(n));
    if (!field) ignored.push(h);
    else if (used.has(field.key)) duplicates.push(h);
    else {
      used.add(field.key);
      mapping[h] = field.key;
      recognized.push({ header: h, field });
    }
  }
  return { mapping, recognized, ignored, duplicates, missingRequired: IMPORT_FIELDS.filter((f) => f.required && !used.has(f.key)) };
}

export interface CleanRow {
  company: string;
  domain: string;
  industry: string | null;
  employees: number | null;
  country: string | null;
  technologies: string[] | null;
  contactName: string | null;
  email: string | null;
  title: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  titleObservedAt: Date | null;
}

function parseEmployees(v: string): number | null | "invalid" {
  const range = v.match(/^(\d[\d,]*)\s*[-–to]+\s*(\d[\d,]*)\+?$/i);
  if (range) return Math.round((Number(range[1].replace(/,/g, "")) + Number(range[2].replace(/,/g, ""))) / 2);
  const n = Number(v.replace(/[,+\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 5_000_000) return "invalid";
  return Math.round(n);
}

/**
 * Validate one row against the template. Any invalid value rejects the whole
 * row with a reason, so only clean, predefined data is stored. Blank cells are
 * fine (they never erase data we already hold).
 */
export function validateRow(raw: Record<string, unknown>, mapping: Record<string, FieldKey>): { ok: true; row: CleanRow } | { ok: false; error: string } {
  const v: Partial<Record<FieldKey, string>> = {};
  for (const [header, key] of Object.entries(mapping)) {
    const cell = raw[header];
    const s = cell == null ? "" : String(cell).trim();
    if (s) v[key] = s;
  }
  const errors: string[] = [];
  if (!v.company) errors.push("Company is required");
  if (v.company && v.company.length > 200) errors.push("Company is longer than 200 characters");
  const domain = normalizeDomain(v.domain);
  if (!v.domain) errors.push("Domain is required");
  else if (!domain) errors.push(`Domain "${v.domain}" is not a valid website`);

  let employees: number | null = null;
  if (v.employees) {
    const e = parseEmployees(v.employees);
    if (e === "invalid") errors.push(`Employees "${v.employees}" is not a number`);
    else employees = e;
  }
  let country: string | null = null;
  if (v.country) {
    country = normalizeCountry(v.country);
    if (!country) errors.push(`Country "${v.country}" is not recognised (use a 2-letter code like US)`);
  }
  let email: string | null = null;
  if (v.email) {
    email = normalizeEmail(v.email);
    if (!isValidEmail(email)) errors.push(`Email "${v.email}" is not valid`);
  }
  let phone: string | null = null;
  if (v.phone) {
    phone = normalizePhone(v.phone);
    if (!phone) errors.push(`Phone "${v.phone}" is not valid (include the country code)`);
  }
  let linkedinUrl: string | null = null;
  if (v.linkedinUrl) {
    linkedinUrl = normalizeLinkedin(v.linkedinUrl);
    if (!linkedinUrl) errors.push(`LinkedIn URL "${v.linkedinUrl}" is not a profile URL`);
  }
  let titleObservedAt: Date | null = null;
  if (v.titleObservedAt) {
    const d = new Date(v.titleObservedAt);
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86_400_000) errors.push(`Title Date "${v.titleObservedAt}" is not a valid past date`);
    else titleObservedAt = d;
  }
  let technologies: string[] | null = null;
  if (v.technologies) {
    technologies = [...new Set(v.technologies.split(/[;|,]/).map((t) => t.trim()).filter(Boolean))].slice(0, 30);
    if (technologies.some((t) => t.length > 60)) errors.push("Tech Stack entries must be under 60 characters each (separate tools with ;)");
  }
  if ((v.title || v.phone || v.linkedinUrl) && !v.contactName && !v.email) errors.push("Contact details need a Contact Name or Email");

  if (errors.length) return { ok: false, error: errors.join("; ") };
  return {
    ok: true,
    row: {
      company: v.company!, domain: domain!, industry: v.industry?.toLowerCase() ?? null, employees, country, technologies,
      contactName: v.contactName ?? null, email, title: v.title ?? null, phone, linkedinUrl, titleObservedAt,
    },
  };
}

export function templateCsv(): string {
  const header = IMPORT_FIELDS.map((f) => f.label).join(",");
  const example = IMPORT_FIELDS.map((f) => (/[,;]/.test(f.example) ? `"${f.example}"` : f.example)).join(",");
  return `${header}\n${example}\n`;
}
