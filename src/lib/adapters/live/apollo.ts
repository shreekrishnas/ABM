// Apollo.io: contact data (people search, person match / email) and the companies Apollo's
// website-visitor tracking identifies. Key in APOLLO_API_KEY; sent in the x-api-key header.
// People search is free; person match reveals an email and costs one Apollo credit.

import { seller } from "@/lib/seller";
import type { DataProvider, PersonQuery, ProviderPerson } from "../types";
import { ApiError, fetchJson } from "./http";

const BASE = "https://api.apollo.io/api/v1";

/** Job titles to search for a buying-group function: the seller pack's personas first, generic titles otherwise. */
export function titlesFor(fn: string): string[] {
  const fromPack = seller().personas.filter((p) => p.functions.includes(fn)).flatMap((p) => p.titles);
  if (fromPack.length) return [...new Set(fromPack)].slice(0, 10);
  const name = fn.replace(/_/g, " ");
  return [`Head of ${name}`, `${name} Director`, `VP ${name}`, `Chief ${name} Officer`];
}

export class ApolloClient {
  /** `waits`: the pauses before each retry (tests pass zeros); the shared defaults otherwise. */
  constructor(private key: string, private waits?: number[]) {}

  post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>(path, "POST", body);
  }

  get<T>(path: string): Promise<T> {
    return this.call<T>(path, "GET");
  }

  // Through the shared helper (adapters/live/http.ts), like the other services: a timeout, retries with
  // growing waits on rate limits (honouring Retry-After), 5xx and network errors, and a short pause for
  // a service that keeps failing. It used to fail the whole run on the first 429 or blip.
  private async call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
    try {
      return await fetchJson<T>("apollo", `${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": this.key },
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs: 20_000,
        ...(this.waits ? { waits: this.waits } : {}),
      });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const detail = e.message.replace(/^apollo -?\d+: /, "").slice(0, 200);
      throw new Error(`Apollo ${path} ${e.status}${e.status === 403 ? " (this API key or plan can't use this endpoint)" : e.status === 429 ? " (rate limit — try later)" : ""}: ${detail}`);
    }
  }
}

interface ApolloPerson {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  organization?: { primary_domain?: string | null; website_url?: string | null } | null;
}

const domainOf = (p: ApolloPerson, fallback: string | null) => {
  const raw = p.organization?.primary_domain ?? p.organization?.website_url ?? fallback;
  return raw ? raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : null;
};

function toPerson(p: ApolloPerson, fallbackDomain: string | null): ProviderPerson | null {
  const fullName = (p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" ")).trim();
  if (!fullName) return null;
  // Apollo marks guessed addresses; only keep ones it has verified or found.
  const email = p.email && !/^email_not_unlocked/.test(p.email) && p.email_status !== "unavailable" ? p.email.toLowerCase() : null;
  return { fullName, title: p.title ?? null, companyDomain: domainOf(p, fallbackDomain), email, emailStatus: email ? (p.email_status ?? null) : null, linkedinUrl: p.linkedin_url ?? null, observedAt: new Date(), source: "apollo" };
}

export class ApolloProvider implements DataProvider {
  readonly name = "apollo";
  private api: ApolloClient;
  constructor(key: string) {
    this.api = new ApolloClient(key);
  }

  private async match(q: PersonQuery): Promise<ProviderPerson | null> {
    const [first, ...rest] = q.fullName.trim().split(/\s+/);
    const r = await this.api.post<{ person?: ApolloPerson | null }>("/people/match", {
      first_name: first, last_name: rest.join(" ") || undefined, domain: q.domain, email: q.email ?? undefined,
      reveal_personal_emails: false, reveal_phone_number: false,
    });
    return r.person ? toPerson(r.person, q.domain) : null;
  }

  lookupPerson(q: PersonQuery) {
    return this.match(q);
  }

  /** Apollo is one source; a re-check against the same source adds nothing, so it isn't repeated. */
  async recheckPerson(): Promise<ProviderPerson | null> {
    return null;
  }

  async findByFunction(domain: string, fn: string, limit: number): Promise<ProviderPerson[]> {
    const r = await this.api.post<{ people?: ApolloPerson[] }>("/mixed_people/api_search", {
      q_organization_domains_list: [domain], person_titles: titlesFor(fn), page: 1, per_page: Math.min(Math.max(limit, 1), 10),
    });
    return (r.people ?? []).map((p) => toPerson(p, domain)).filter((p): p is ProviderPerson => Boolean(p)).slice(0, limit);
  }

  async findByTitles(domain: string, titles: string[], limit: number): Promise<ProviderPerson[]> {
    if (!titles.length) return [];
    const r = await this.api.post<{ people?: ApolloPerson[] }>("/mixed_people/api_search", {
      q_organization_domains_list: [domain], person_titles: titles.slice(0, 10), page: 1, per_page: Math.min(Math.max(limit, 1), 10),
    });
    return (r.people ?? []).map((p) => toPerson(p, domain)).filter((p): p is ProviderPerson => Boolean(p)).slice(0, limit);
  }

  async findEmail(fullName: string, domain: string): Promise<string | null> {
    return (await this.match({ fullName, domain }))?.email ?? null;
  }
}

// ── Website visitors ──

export interface ApolloVisitorCompany {
  name: string;
  domain: string | null;
  /** When Apollo last saw activity for the account (its website visit), if Apollo says. */
  lastSeenAt: Date | null;
  /** Which Apollo field the date came from. */
  dateField: string | null;
  /** Employees, annual revenue (USD) and industry, when Apollo's list returns them (no extra request). */
  facts?: VisitorFacts | null;
}

/** Company facts Apollo returns with a company: employees, annual revenue in US dollars, industry. */
export interface VisitorFacts { employees: number | null; revenueUsd: number | null; industry: string | null }

const posNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*[\d,.]+\s*$/.test(v) ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
/**
 * Employees, revenue and industry from an Apollo company or account. Apollo puts them on the company
 * itself (estimated_num_employees, annual_revenue / organization_revenue, industry) or, on an account, on
 * its nested organization. Nothing found: null (never estimated).
 */
export function visitorFacts(o: Record<string, unknown> | null | undefined): VisitorFacts | null {
  if (!o) return null;
  const org = (o.organization && typeof o.organization === "object" ? o.organization : {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = o[k] ?? org[k];
      if (v != null && v !== "") return v;
    }
    return null;
  };
  const employees = posNum(pick("estimated_num_employees", "num_employees"));
  const revenueUsd = posNum(pick("annual_revenue", "organization_revenue"));
  const ind = pick("industry");
  const industry = typeof ind === "string" && ind.trim() ? ind.trim() : null;
  return employees || revenueUsd || industry ? { employees: employees ? Math.round(employees) : null, revenueUsd, industry } : null;
}

/** Apollo's date fields on an account, most specific first. */
const VISIT_DATE_FIELDS = ["last_website_visit_at", "website_visit_last_at", "last_activity_date", "account_last_activity_date", "updated_at", "created_at"] as const;

function visitDate(a: Record<string, unknown>): { at: Date | null; field: string | null } {
  for (const f of VISIT_DATE_FIELDS) {
    const v = a[f];
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return { at: new Date(v), field: f };
  }
  return { at: null, field: null };
}

export interface ApolloLabel { id: string; name: string; modality?: string; cached_count?: number }

/** Account lists in Apollo (needs a master API key). */
export async function apolloAccountLists(key: string): Promise<ApolloLabel[]> {
  const labels = await new ApolloClient(key).get<ApolloLabel[] | { labels?: ApolloLabel[] }>("/labels");
  const all = Array.isArray(labels) ? labels : labels.labels ?? [];
  return all.filter((l) => !l.modality || l.modality === "accounts");
}

/**
 * The account list holding website visitors: the one named in APOLLO_VISITOR_LIST / its id in
 * APOLLO_VISITOR_LABEL_ID, otherwise any account list whose name mentions "visitor"
 * (Apollo's own visitor lists and most team-made ones do). Null when there is none.
 */
export async function resolveVisitorList(key: string, list: { id?: string; name?: string }): Promise<{ id: string; name: string; how: "configured" | "found" } | null> {
  if (list.id) return { id: list.id, name: list.name ?? list.id, how: "configured" };
  const lists = await apolloAccountLists(key);
  if (list.name) {
    const want = list.name.trim().toLowerCase();
    const hit = lists.find((l) => l.name.trim().toLowerCase() === want);
    if (!hit) throw new Error(`Apollo has no account list named "${list.name}" (lists found: ${lists.map((l) => l.name).slice(0, 10).join(", ") || "none"})`);
    return { id: hit.id, name: hit.name, how: "configured" };
  }
  const hit = lists.filter((l) => /visit/i.test(l.name)).sort((a, b) => (b.cached_count ?? 0) - (a.cached_count ?? 0))[0];
  return hit ? { id: hit.id, name: hit.name, how: "found" } : null;
}

/**
 * Companies Apollo's website-visitor tracking identified. Apollo's API has no visitors
 * endpoint, so visitors are read from the account list they're saved to in Apollo (by hand
 * or by an Apollo workflow): the configured list, or one whose name mentions "visitor".
 */
/**
 * Every company on the visitor list, newest activity first, 100 per page up to `maxPages`. The result
 * carries how many pages the list has, so a list longer than we read is said, never cut silently.
 */
export async function apolloVisitorCompanies(key: string, list: { id?: string; name?: string }, maxPages = 20, waits?: number[]): Promise<ApolloVisitorCompany[] & { totalPages?: number; truncated?: boolean }> {
  const api = new ApolloClient(key, waits);
  const found = await resolveVisitorList(key, list);
  if (!found) throw new Error("No Apollo visitor list was found.");
  const labelId = found.id;
  const out: ApolloVisitorCompany[] & { totalPages?: number; truncated?: boolean } = [];
  let totalPages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const r = await api.post<{ accounts?: ({ name?: string | null; domain?: string | null; website_url?: string | null } & Record<string, unknown>)[]; pagination?: { total_pages?: number } }>("/accounts/search", {
      account_label_ids: [labelId], page, per_page: 100, sort_by_field: "account_last_activity_date", sort_ascending: false,
    });
    for (const a of r.accounts ?? []) {
      if (!a.name) continue;
      const raw = a.domain ?? a.website_url ?? null;
      const d = visitDate(a);
      out.push({ name: a.name, domain: raw ? raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : null, lastSeenAt: d.at, dateField: d.field, facts: visitorFacts(a) });
    }
    totalPages = r.pagination?.total_pages ?? page;
    if (!r.pagination?.total_pages || page >= r.pagination.total_pages) break;
  }
  // Not enumerable: the list itself stays a plain list of companies.
  Object.defineProperties(out, { totalPages: { value: totalPages }, truncated: { value: totalPages > maxPages } });
  return out;
}

// ── Real website visit dates ──

type IntentAccount = {
  last_visited_at?: number | string | null;
  last_visited_at_datetime?: string | null;
  domain_aggregates?: { domain?: string | null; last_visit?: number | string | null }[] | null;
};
const cleanHost = (raw: string | null | undefined) => (raw ? raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() : "");

/** Apollo writes visit dates as 20261031 (a number or text) or as an ISO timestamp. */
export function apolloDate(v: number | string | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const t = String(v).trim();
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The company's last visit to our site, from Apollo's visitor data on a company. Visits to other
 * tracked sites don't count: when Apollo breaks visits down by site and ours isn't there, the
 * answer is "no visit to this site". Without a breakdown, the combined date is used.
 */
export function visitToSite(intent: IntentAccount | null | undefined, site: string | null): { at: Date; field: string } | "other_site" | null {
  if (!intent) return null;
  const want = cleanHost(site);
  const byDomain = intent.domain_aggregates ?? [];
  if (want && byDomain.length) {
    const hit = byDomain.find((d) => {
      const h = cleanHost(d.domain);
      return h === want || h.endsWith(`.${want}`);
    });
    const at = hit ? apolloDate(hit.last_visit) : null;
    return at ? { at, field: `domain_aggregates.last_visit (${want})` } : "other_site";
  }
  const at = apolloDate(intent.last_visited_at_datetime) ?? apolloDate(intent.last_visited_at);
  return at ? { at, field: "intent_signal_account.last_visited_at" } : null;
}

/**
 * Real last-visit dates for these company domains, from Apollo's company search (the list itself
 * only gives "last activity", which is when a company was saved). 100 domains per call.
 */
export async function apolloVisitDates(key: string, domains: string[], site: string | null, facts?: Map<string, VisitorFacts>): Promise<Map<string, { at: Date; field: string } | "other_site">> {
  const api = new ApolloClient(key);
  const out = new Map<string, { at: Date; field: string } | "other_site">();
  const unique = [...new Set(domains.map(cleanHost).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const r = await api.post<{ organizations?: (Record<string, unknown> & { intent_signal_account?: IntentAccount | null })[]; accounts?: (Record<string, unknown> & { intent_signal_account?: IntentAccount | null })[] }>("/mixed_companies/search", {
      q_organization_domains_list: batch, page: 1, per_page: 100,
    });
    for (const o of [...(r.organizations ?? []), ...(r.accounts ?? [])]) {
      const host = cleanHost((o.primary_domain as string | undefined) ?? (o.domain as string | undefined) ?? (o.website_url as string | undefined));
      if (!host || !batch.includes(host)) continue;
      // The same answer carries the company's employees, revenue and industry: kept, no extra request.
      const f = facts ? visitorFacts(o) : null;
      if (f && facts) {
        const had = facts.get(host);
        facts.set(host, { employees: had?.employees ?? f.employees, revenueUsd: had?.revenueUsd ?? f.revenueUsd, industry: had?.industry ?? f.industry });
      }
      const v = visitToSite(o.intent_signal_account, site);
      if (!v) continue;
      // Keep the most useful answer if a company comes back twice (as organization and account).
      const prev = out.get(host);
      if (!prev || prev === "other_site" || (v !== "other_site" && v.at > prev.at)) out.set(host, v);
    }
  }
  return out;
}

/** A plain check of the key: does it work, is it a master key, which account lists exist, which one holds visitors. */
export async function apolloHealth(key: string, list: { id?: string; name?: string }) {
  const api = new ApolloClient(key);
  const out: { keyWorks: boolean; master: boolean | null; lists: string[]; visitorList: string | null; visitorListHow: string | null; visitorCompanies: number | null; problems: string[] } = { keyWorks: false, master: null, lists: [], visitorList: null, visitorListHow: null, visitorCompanies: null, problems: [] };
  try {
    await api.get<unknown>("/auth/health");
    out.keyWorks = true;
  } catch (e) {
    out.problems.push(`Key check failed: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`);
  }
  try {
    const lists = await apolloAccountLists(key);
    out.keyWorks = true;
    out.master = true;
    out.lists = lists.map((l) => `${l.name}${l.cached_count != null ? ` (${l.cached_count})` : ""}`);
    const v = await resolveVisitorList(key, list);
    if (v) {
      out.visitorList = v.name;
      out.visitorListHow = v.how;
      const r = await api.post<{ pagination?: { total_entries?: number }; accounts?: unknown[] }>("/accounts/search", { account_label_ids: [v.id], page: 1, per_page: 1 });
      out.visitorCompanies = r.pagination?.total_entries ?? r.accounts?.length ?? 0;
    } else out.problems.push(`No account list with "visitor" in its name (lists: ${out.lists.slice(0, 10).join(", ") || "none"}). In Apollo, save website visitors to an account list named e.g. "Website Visitors".`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ 403/.test(msg)) out.master = false;
    out.problems.push(/ 403/.test(msg) ? "Apollo website visitors are not available with the current connection." : `Reading account lists failed: ${msg.slice(0, 200)}`);
  }
  return out;
}

// ── Companies ──

export interface ApolloOrg {
  name: string;
  domain: string | null;
  industry: string | null;
  employees: number | null;
  country: string | null;
  keywords: string[];
  linkedinUrl?: string | null;
  city?: string | null;
  technologies?: string[];
  /** Apollo's annual revenue figure (US dollars; Apollo gives no reporting period). Null when Apollo has none. */
  annualRevenueUsd?: number | null;
}

interface RawOrg {
  name?: string | null;
  primary_domain?: string | null;
  website_url?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  country?: string | null;
  keywords?: string[] | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  technology_names?: string[] | null;
  current_technologies?: { name?: string | null }[] | null;
  annual_revenue?: number | null;
}

const cleanDomain = (raw: string | null | undefined) => (raw ? raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : null);
const toOrg = (o: RawOrg): ApolloOrg | null =>
  o.name
    ? {
        name: o.name, domain: cleanDomain(o.primary_domain ?? o.website_url), industry: o.industry ?? null, employees: o.estimated_num_employees ?? null, country: o.country ?? null, keywords: (o.keywords ?? []).slice(0, 12),
        linkedinUrl: o.linkedin_url ?? null, city: o.city ?? null,
        technologies: [...new Set([...(o.technology_names ?? []), ...(o.current_technologies ?? []).map((t) => t.name ?? "")].filter(Boolean))].slice(0, 20),
        annualRevenueUsd: typeof o.annual_revenue === "number" && Number.isFinite(o.annual_revenue) && o.annual_revenue > 0 ? o.annual_revenue : null,
      }
    : null;

/** One company's profile by its website (no credits for basic firmographics). */
export async function apolloOrgEnrich(key: string, domain: string): Promise<ApolloOrg | null> {
  const r = await new ApolloClient(key).get<{ organization?: RawOrg | null }>(`/organizations/enrich?domain=${encodeURIComponent(domain)}`);
  return r.organization ? toOrg(r.organization) : null;
}

/** Apollo's employee-range buckets that cover a minimum size. */
export function employeeRanges(min: number | null | undefined): string[] {
  const buckets: [number, number | null][] = [[1, 10], [11, 20], [21, 50], [51, 100], [101, 200], [201, 500], [501, 1000], [1001, 2000], [2001, 5000], [5001, 10000], [10001, null]];
  return buckets.filter(([, hi]) => !min || hi === null || hi >= min).map(([lo, hi]) => `${lo},${hi ?? ""}`);
}

/** Companies matching keywords, size and locations (Apollo's company database). */
export async function apolloOrgSearch(key: string, q: { keywords: string[]; minEmployees?: number | null; locations?: string[]; perPage?: number }): Promise<ApolloOrg[]> {
  const r = await new ApolloClient(key).post<{ organizations?: RawOrg[]; accounts?: RawOrg[] }>("/mixed_companies/search", {
    q_organization_keyword_tags: q.keywords.slice(0, 5),
    organization_num_employees_ranges: employeeRanges(q.minEmployees),
    ...(q.locations?.length ? { organization_locations: q.locations } : {}),
    page: 1, per_page: Math.min(q.perPage ?? 25, 100),
  });
  return [...(r.organizations ?? []), ...(r.accounts ?? [])].map(toOrg).filter((o): o is ApolloOrg => Boolean(o));
}


// ── Prospects for website-visitor companies (every CSV-import person field) ──

export interface ApolloProspect {
  firstName: string;
  lastName: string | null;
  fullName: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  seniority: string | null;
  department: string | null;
  location: string | null;
  companyDomain: string | null;
}

interface RawPerson {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  seniority?: string | null;
  departments?: string[] | null;
  subdepartments?: string[] | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone_numbers?: { sanitized_number?: string | null; raw_number?: string | null }[] | null;
  organization?: { primary_domain?: string | null; website_url?: string | null } | null;
}

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function toProspect(p: RawPerson, fallbackDomain: string): ApolloProspect | null {
  const first = (p.first_name ?? p.name?.split(/\s+/)[0] ?? "").trim();
  if (!first) return null;
  // The free search hides surnames ("S***"): keep a surname only when Apollo gives it in full.
  const last = p.last_name && !/\*/.test(p.last_name) ? p.last_name.trim() : null;
  const email = p.email && !/^email_not_unlocked/.test(p.email) && p.email_status !== "unavailable" ? p.email.toLowerCase() : null;
  const phone = p.phone_numbers?.find((n) => n.sanitized_number || n.raw_number);
  const dept = p.departments?.[0] ?? p.subdepartments?.[0] ?? null;
  const raw = p.organization?.primary_domain ?? p.organization?.website_url ?? fallbackDomain;
  return {
    firstName: first, lastName: last, fullName: [first, last].filter(Boolean).join(" "), title: p.title ?? null, email, linkedinUrl: p.linkedin_url ?? null,
    phone: phone?.sanitized_number ?? phone?.raw_number ?? null, seniority: p.seniority ? titleCase(p.seniority) : null,
    department: dept ? titleCase(dept.replace(/^master_/, "")) : null, location: [p.city, p.state, p.country].filter(Boolean).join(", ") || null,
    companyDomain: cleanDomain(raw),
  };
}

/**
 * People in the target roles at one company. The search is free; with `reveal` each person is
 * matched by id (one Apollo credit each) for the full name, email, LinkedIn, seniority,
 * department and location.
 */
export async function apolloProspects(key: string, domain: string, titles: string[], limit: number, reveal: boolean): Promise<{ people: ApolloProspect[]; revealed: number }> {
  const api = new ApolloClient(key);
  const r = await api.post<{ people?: RawPerson[] }>("/mixed_people/api_search", {
    q_organization_domains_list: [domain], person_titles: titles.slice(0, 10), page: 1, per_page: Math.min(Math.max(limit, 1), 10),
  });
  const found = (r.people ?? []).slice(0, limit);
  const people: ApolloProspect[] = [];
  let revealed = 0;
  for (const p of found) {
    let full: RawPerson = p;
    if (reveal && p.id) {
      const m = await api.post<{ person?: RawPerson | null }>("/people/match", { id: p.id, reveal_personal_emails: false, reveal_phone_number: false });
      if (m.person) {
        full = { ...p, ...m.person };
        revealed++;
      }
    }
    const x = toProspect(full, domain);
    if (x) people.push(x);
  }
  return { people, revealed };
}
