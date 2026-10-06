// The predefined import fields ("Import Companies & People"). Only these fields are
// accepted and stored; columns the user leaves unmapped are ignored and reported.
// One CSV carries companies, people and (optionally) LinkedIn activity. To accept a
// new column, add it here (and to the database schema) — nothing else changes.
//
// Client-safe: no database imports. Used by the browser to map and preview a file
// and by the server to validate every row with the same rules.

import {
  companyNameKey, isValidEmail, normalizeCompanyLinkedin, normalizeCountry, normalizeDomain, normalizeEmail, normalizeLinkedin, normalizePhone, splitName,
} from "@/lib/pipeline/normalize";
import { parseStage, type Stage } from "@/lib/journey/stages";

export type FieldKey =
  // Company
  | "company" | "domain" | "companyLinkedin" | "industry" | "employees" | "city" | "country" | "technologies" | "keywords" | "dataSource" | "companyNotes"
  // People
  | "firstName" | "lastName" | "contactName" | "title" | "linkedinUrl" | "email" | "phone" | "department" | "seniority" | "location" | "personNotes" | "titleObservedAt"
  // LinkedIn activity (optional)
  | "connectionSent" | "connectionAccepted" | "followUps" | "lastFollowUp" | "lastReply" | "lastReplyDate" | "stage";

export type FieldGroup = "Company" | "People" | "LinkedIn activity";

export interface ImportField {
  key: FieldKey;
  label: string; // header used in the template
  group: FieldGroup;
  requirement: "required" | "recommended" | "optional";
  aliases: string[]; // other header spellings suggested automatically (lowercase, spaces)
  example: string;
  help: string;
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: "company", label: "Company Name", group: "Company", requirement: "required", aliases: ["company", "company name", "account", "account name", "organization", "organisation", "organization name"], example: "ABC Manufacturing", help: "Primary company name" },
  { key: "domain", label: "Company Website", group: "Company", requirement: "recommended", aliases: ["domain", "website", "company domain", "url", "company website", "company url", "website url", "company website or domain"], example: "abcmanufacturing.com", help: "Website or domain — first key for matching and duplicate prevention" },
  { key: "companyLinkedin", label: "Company LinkedIn URL", group: "Company", requirement: "optional", aliases: ["company linkedin url", "company linkedin", "linkedin company url", "linkedin company", "company linkedin page", "company li url", "linkedin company page"], example: "https://www.linkedin.com/company/abc-manufacturing", help: "Second company identifier" },
  { key: "industry", label: "Industry", group: "Company", requirement: "optional", aliases: ["industry", "sector", "vertical"], example: "Manufacturing", help: "Industry classification" },
  { key: "employees", label: "Employee Size", group: "Company", requirement: "optional", aliases: ["employees", "employee size", "employee count", "headcount", "company size", "size", "# employees", "number of employees"], example: "500-1000", help: "Number or range like 200-500" },
  { key: "city", label: "City or Location", group: "Company", requirement: "optional", aliases: ["city", "company city", "company location", "hq city", "city or location", "hq location"], example: "Pune", help: "Geographic information" },
  { key: "country", label: "Country", group: "Company", requirement: "optional", aliases: ["country", "hq country", "company country"], example: "India", help: "2-letter code (IN, US) or country name" },
  { key: "technologies", label: "Technologies Used", group: "Company", requirement: "optional", aliases: ["technologies used", "tech stack", "technologies", "technology", "tech", "software used", "erp", "systems used"], example: "SAP S/4HANA; Informatica", help: "Separate with ; — used in the fit score" },
  { key: "keywords", label: "Keywords", group: "Company", requirement: "optional", aliases: ["keywords", "keyword", "tags", "company keywords"], example: "Additive Manufacturing; Aerospace; Polymer Printing", help: "Products, capabilities, markets — separate with ;" },
  { key: "dataSource", label: "Data Source", group: "Company", requirement: "optional", aliases: ["data source", "source", "lead source", "list source"], example: "Apollo", help: "Apollo, LinkedIn, CSV Import, Manual Entry… (default: CSV Import)" },
  { key: "companyNotes", label: "Company Notes", group: "Company", requirement: "optional", aliases: ["company notes", "account notes", "company note"], example: "Expanding plant in Chakan", help: "Additional company information" },

  { key: "firstName", label: "First Name", group: "People", requirement: "required", aliases: ["first name", "firstname", "given name", "first"], example: "Rahul", help: "Required for each person (or a Full Name)" },
  { key: "lastName", label: "Last Name", group: "People", requirement: "recommended", aliases: ["last name", "lastname", "surname", "family name", "last"], example: "Sharma", help: "" },
  { key: "contactName", label: "Full Name", group: "People", requirement: "optional", aliases: ["full name", "contact name", "name", "contact", "person", "prospect", "prospect name", "person name"], example: "Rahul Sharma", help: "Use when the file has one name column" },
  { key: "title", label: "Job Title", group: "People", requirement: "recommended", aliases: ["job title", "title", "position", "role", "designation"], example: "Head of Production", help: "Person's role" },
  { key: "linkedinUrl", label: "Person LinkedIn URL", group: "People", requirement: "recommended", aliases: ["person linkedin url", "linkedin url", "linkedin", "linkedin profile", "profile url", "person linkedin", "linkedin profile url"], example: "https://www.linkedin.com/in/rahul-sharma", help: "First key for matching people" },
  { key: "email", label: "Email", group: "People", requirement: "optional", aliases: ["email", "e-mail", "work email", "email address", "contact email", "business email"], example: "rahul.sharma@abcmanufacturing.com", help: "" },
  { key: "phone", label: "Phone", group: "People", requirement: "optional", aliases: ["phone", "phone number", "mobile", "mobile number", "direct dial", "contact number", "work phone"], example: "+91 98765 43210", help: "With country code" },
  { key: "department", label: "Department", group: "People", requirement: "optional", aliases: ["department", "function", "team", "dept"], example: "Operations", help: "" },
  { key: "seniority", label: "Seniority", group: "People", requirement: "optional", aliases: ["seniority", "level", "seniority level"], example: "Director", help: "" },
  { key: "location", label: "Location", group: "People", requirement: "optional", aliases: ["person location", "contact location", "person city", "contact city"], example: "Mumbai", help: "Where the person is based" },
  { key: "personNotes", label: "Notes", group: "People", requirement: "optional", aliases: ["notes", "person notes", "contact notes", "note"], example: "Met at IMTEX", help: "" },
  { key: "titleObservedAt", label: "Title Date", group: "People", requirement: "optional", aliases: ["title date", "title observed at", "title observed", "last verified"], example: "2026-09-15", help: "When the title was last known true" },

  { key: "connectionSent", label: "Connection Sent", group: "LinkedIn activity", requirement: "optional", aliases: ["connection sent", "connection sent date", "invite sent", "invitation sent", "connection request sent"], example: "2026-09-20", help: "Date (or Yes)" },
  { key: "connectionAccepted", label: "Connection Accepted", group: "LinkedIn activity", requirement: "optional", aliases: ["connection accepted", "connection accepted date", "accepted", "accepted date", "invite accepted"], example: "2026-09-22", help: "Date (or Yes)" },
  { key: "followUps", label: "Follow-ups Sent", group: "LinkedIn activity", requirement: "optional", aliases: ["follow-ups sent", "follow ups sent", "followups sent", "follow ups", "followups", "follow-up count", "follow up count", "messages sent"], example: "2", help: "Number of follow-ups sent" },
  { key: "lastFollowUp", label: "Last Follow-up Date", group: "LinkedIn activity", requirement: "optional", aliases: ["last follow-up date", "last follow up date", "last followup", "last follow up", "last message date"], example: "2026-09-29", help: "" },
  { key: "lastReply", label: "Last Reply", group: "LinkedIn activity", requirement: "optional", aliases: ["last reply", "reply", "response", "reply text", "last response"], example: "Please share more details.", help: "Its meaning sets the stage" },
  { key: "lastReplyDate", label: "Last Reply Date", group: "LinkedIn activity", requirement: "optional", aliases: ["last reply date", "reply date", "replied at", "response date"], example: "2026-10-01", help: "" },
  { key: "stage", label: "Stage", group: "LinkedIn activity", requirement: "optional", aliases: ["stage", "people stage", "status", "lead status", "current stage"], example: "Details Requested", help: "One of the 17 stages — overrides the calculated stage" },
];

export const FIELD_BY_KEY = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f])) as Record<FieldKey, ImportField>;
const FIELD_KEYS = new Set<string>(IMPORT_FIELDS.map((f) => f.key));
export const isFieldKey = (k: string): k is FieldKey => FIELD_KEYS.has(k);

// "contactName" → "contact name", "Work_Email" → "work email"
const norm = (h: string) =>
  h.trim().replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ").replace(/\blinked in\b/g, "linkedin").replace(/\be mail\b/g, "email");

export interface HeaderAnalysis {
  /** original header → field key */
  mapping: Record<string, FieldKey>;
  recognized: { header: string; field: ImportField }[];
  ignored: string[];
  missingRequired: ImportField[];
  duplicates: string[];
}

/** Suggest a mapping from header names; the wizard lets the user change it. */
export function analyzeHeaders(headers: string[]): HeaderAnalysis {
  const mapping: Record<string, FieldKey> = {};
  for (const h of headers) {
    if (!h || !h.trim()) continue;
    const n = norm(h);
    const field = IMPORT_FIELDS.find((f) => norm(f.label) === n) ?? IMPORT_FIELDS.find((f) => f.aliases.includes(n) || f.aliases.includes(n.replace(/-/g, " ")));
    if (field && !Object.values(mapping).includes(field.key)) mapping[h] = field.key;
  }
  return analyzeMapping(headers, mapping);
}

/** Check a (possibly user-edited) mapping. */
export function analyzeMapping(headers: string[], raw: Record<string, string>): HeaderAnalysis {
  const mapping: Record<string, FieldKey> = {};
  const recognized: HeaderAnalysis["recognized"] = [];
  const ignored: string[] = [];
  const duplicates: string[] = [];
  const used = new Set<FieldKey>();
  for (const h of headers) {
    if (!h || !h.trim()) continue;
    const k = raw[h];
    if (!k || !isFieldKey(k)) ignored.push(h);
    else if (used.has(k)) duplicates.push(h);
    else {
      used.add(k);
      mapping[h] = k;
      recognized.push({ header: h, field: FIELD_BY_KEY[k] });
    }
  }
  const missingRequired = used.has("company") ? [] : [FIELD_BY_KEY.company];
  // People fields mapped → a first name (or a full name) must be mapped too.
  const people = ["lastName", "title", "linkedinUrl", "email", "phone", "department", "seniority", "location", "personNotes"] as const;
  if (people.some((k) => used.has(k)) && !used.has("firstName") && !used.has("contactName")) missingRequired.push(FIELD_BY_KEY.firstName);
  return { mapping, recognized, ignored, duplicates, missingRequired };
}

export interface PersonRow {
  firstName: string;
  lastName: string | null;
  fullName: string;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  seniority: string | null;
  location: string | null;
  notes: string | null;
  titleObservedAt: Date | null;
}

export interface ActivityRow {
  connectionSent: Date | true | null;
  connectionAccepted: Date | true | null;
  followUps: number | null;
  lastFollowUp: Date | null;
  lastReply: string | null;
  lastReplyDate: Date | null;
  stage: Stage | null;
}

export interface CleanRow {
  company: string;
  nameKey: string;
  domain: string | null;
  companyLinkedin: string | null;
  industry: string | null;
  employees: number | null;
  city: string | null;
  country: string | null;
  technologies: string[] | null;
  keywords: string[] | null;
  dataSource: string | null;
  companyNotes: string | null;
  person: PersonRow | null;
  activity: ActivityRow | null;
}

function parseEmployees(v: string): number | null | "invalid" {
  const range = v.match(/^(\d[\d,]*)\s*[-–to]+\s*(\d[\d,]*)\+?$/i);
  if (range) return Math.round((Number(range[1].replace(/,/g, "")) + Number(range[2].replace(/,/g, ""))) / 2);
  const n = Number(v.replace(/[,+\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 5_000_000) return "invalid";
  return Math.round(n);
}

const list = (v: string, max: number) => [...new Set(v.split(/[;|]/).flatMap((t) => (v.includes(";") || v.includes("|") ? [t] : t.split(","))).map((t) => t.trim()).filter(Boolean))].slice(0, max);

function parseDate(v: string): Date | null | "invalid" {
  const s = v.trim();
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // 20/09/2026 (day first, as used in India/UK)
  const d = dmy ? new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))) : new Date(s);
  if (Number.isNaN(d.getTime())) return "invalid";
  if (d.getTime() > Date.now() + 86_400_000) return "invalid";
  return d;
}

const YES = /^(y|yes|true|1|done|sent|accepted|✓|x)$/i;
const NO = /^(n|no|false|0|-|not sent|pending)$/i;

/**
 * Validate one row against the mapped fields. Any invalid value rejects the whole
 * row with a reason, so only clean, predefined data is stored. Blank cells are fine
 * (they never erase data we already hold).
 */
export function validateRow(raw: Record<string, unknown>, mapping: Record<string, FieldKey>): { ok: true; row: CleanRow } | { ok: false; error: string } {
  const v: Partial<Record<FieldKey, string>> = {};
  for (const [header, key] of Object.entries(mapping)) {
    const cell = raw[header];
    const s = cell == null ? "" : String(cell).trim();
    if (s) v[key] = s;
  }
  const errors: string[] = [];
  if (!v.company) errors.push("Company Name is required");
  if (v.company && v.company.length > 200) errors.push("Company Name is longer than 200 characters");
  const domain = v.domain ? normalizeDomain(v.domain) : null;
  if (v.domain && !domain) errors.push(`Company Website "${v.domain}" is not a valid website`);
  const companyLinkedin = v.companyLinkedin ? normalizeCompanyLinkedin(v.companyLinkedin) : null;
  if (v.companyLinkedin && !companyLinkedin) errors.push(`Company LinkedIn URL "${v.companyLinkedin}" is not a company page`);

  let employees: number | null = null;
  if (v.employees) {
    const e = parseEmployees(v.employees);
    if (e === "invalid") errors.push(`Employee Size "${v.employees}" is not a number`);
    else employees = e;
  }
  let country: string | null = null;
  if (v.country) {
    country = normalizeCountry(v.country);
    if (!country) errors.push(`Country "${v.country}" is not recognised (use a 2-letter code like IN)`);
  }
  let technologies: string[] | null = null;
  if (v.technologies) {
    technologies = list(v.technologies, 30);
    if (technologies.some((t) => t.length > 60)) errors.push("Technologies Used entries must be under 60 characters each (separate with ;)");
  }
  let keywords: string[] | null = null;
  if (v.keywords) {
    keywords = list(v.keywords, 40);
    if (keywords.some((t) => t.length > 80)) errors.push("Keywords must be under 80 characters each (separate with ;)");
  }

  // ── Person ──
  let person: PersonRow | null = null;
  const personKeys: FieldKey[] = ["firstName", "lastName", "contactName", "title", "linkedinUrl", "email", "phone", "department", "seniority", "location", "personNotes"];
  if (personKeys.some((k) => v[k])) {
    const split = v.contactName ? splitName(v.contactName) : { first: null, last: null };
    const firstName = v.firstName ?? split.first;
    const lastName = v.lastName ?? split.last ?? null;
    if (!firstName) errors.push("First Name is required for each person");
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
      if (!linkedinUrl) errors.push(`Person LinkedIn URL "${v.linkedinUrl}" is not a profile URL (linkedin.com/in/…)`);
    }
    let titleObservedAt: Date | null = null;
    if (v.titleObservedAt) {
      const d = parseDate(v.titleObservedAt);
      if (d === "invalid") errors.push(`Title Date "${v.titleObservedAt}" is not a valid past date`);
      else titleObservedAt = d;
    }
    const fullName = [firstName, lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    person = {
      firstName: firstName ?? "", lastName, fullName, title: v.title ?? null, linkedinUrl, email, phone,
      department: v.department ?? null, seniority: v.seniority ?? null, location: v.location ?? null, notes: v.personNotes ?? null, titleObservedAt,
    };
  }

  // ── LinkedIn activity ──
  let activity: ActivityRow | null = null;
  const actKeys: FieldKey[] = ["connectionSent", "connectionAccepted", "followUps", "lastFollowUp", "lastReply", "lastReplyDate", "stage"];
  if (actKeys.some((k) => v[k])) {
    if (!person) errors.push("LinkedIn activity needs a person on the same row");
    const flag = (k: "connectionSent" | "connectionAccepted"): Date | true | null => {
      const s = v[k];
      if (!s || NO.test(s)) return null;
      if (YES.test(s)) return true;
      const d = parseDate(s);
      if (d === "invalid") {
        errors.push(`${FIELD_BY_KEY[k].label} "${s}" is not a date or Yes/No`);
        return null;
      }
      return d;
    };
    const date = (k: "lastFollowUp" | "lastReplyDate") => {
      const s = v[k];
      if (!s) return null;
      const d = parseDate(s);
      if (d === "invalid") {
        errors.push(`${FIELD_BY_KEY[k].label} "${s}" is not a valid past date`);
        return null;
      }
      return d;
    };
    let followUps: number | null = null;
    if (v.followUps) {
      const n = Number(v.followUps.replace(/\+$/, ""));
      if (!Number.isInteger(n) || n < 0 || n > 50) errors.push(`Follow-ups Sent "${v.followUps}" is not a whole number`);
      else followUps = n;
    }
    let stage: Stage | null = null;
    if (v.stage) {
      stage = parseStage(v.stage);
      if (!stage) errors.push(`Stage "${v.stage}" is not one of the 17 stages`);
    }
    activity = {
      connectionSent: flag("connectionSent"), connectionAccepted: flag("connectionAccepted"), followUps, lastFollowUp: date("lastFollowUp"),
      lastReply: v.lastReply ? v.lastReply.slice(0, 2000) : null, lastReplyDate: date("lastReplyDate"), stage,
    };
  }

  if (errors.length) return { ok: false, error: errors.join("; ") };
  return {
    ok: true,
    row: {
      company: v.company!, nameKey: companyNameKey(v.company!), domain, companyLinkedin, industry: v.industry?.toLowerCase() ?? null, employees,
      city: v.city ?? null, country, technologies, keywords, dataSource: v.dataSource ?? null, companyNotes: v.companyNotes ?? null, person, activity,
    },
  };
}

/** Keys used to preview matches and find duplicates inside a file. */
export function rowKeys(r: CleanRow) {
  return {
    company: r.domain ? `d:${r.domain}` : r.companyLinkedin ? `l:${r.companyLinkedin}` : `n:${r.nameKey}`,
    domain: r.domain, companyLinkedin: r.companyLinkedin, nameKey: r.nameKey,
    person: r.person ? (r.person.linkedinUrl ? `l:${r.person.linkedinUrl}` : r.person.email ? `e:${r.person.email}` : `n:${r.person.fullName.toLowerCase()}|${r.nameKey}`) : null,
    personLinkedin: r.person?.linkedinUrl ?? null, email: r.person?.email ?? null, fullName: r.person?.fullName ?? null,
  };
}

export function templateCsv(): string {
  const quote = (s: string) => (/[,;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const fields = IMPORT_FIELDS.filter((f) => f.key !== "contactName" && f.key !== "titleObservedAt");
  return `${fields.map((f) => quote(f.label)).join(",")}\n${fields.map((f) => quote(f.example)).join(",")}\n`;
}
