// Apollo.io: contact data (people search, person match / email) and the companies Apollo's
// website-visitor tracking identifies. Key in APOLLO_API_KEY; sent in the x-api-key header.
// People search is free; person match reveals an email and costs one Apollo credit.

import { seller } from "@/lib/seller";
import type { DataProvider, PersonQuery, ProviderPerson } from "../types";

const BASE = "https://api.apollo.io/api/v1";

/** Job titles to search for a buying-group function: the seller pack's personas first, generic titles otherwise. */
export function titlesFor(fn: string): string[] {
  const fromPack = seller().personas.filter((p) => p.functions.includes(fn)).flatMap((p) => p.titles);
  if (fromPack.length) return [...new Set(fromPack)].slice(0, 10);
  const name = fn.replace(/_/g, " ");
  return [`Head of ${name}`, `${name} Director`, `VP ${name}`, `Chief ${name} Officer`];
}

export class ApolloClient {
  constructor(private key: string) {}

  post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>(path, "POST", body);
  }

  get<T>(path: string): Promise<T> {
    return this.call<T>(path, "GET");
  }

  private async call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": this.key },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`Apollo ${path} ${res.status}${res.status === 403 ? " (this API key or plan can't use this endpoint)" : res.status === 429 ? " (rate limit — try later)" : ""}: ${text}`);
    }
    return (await res.json()) as T;
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
  return { fullName, title: p.title ?? null, companyDomain: domainOf(p, fallbackDomain), email, linkedinUrl: p.linkedin_url ?? null, observedAt: new Date(), source: "apollo" };
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
export async function apolloVisitorCompanies(key: string, list: { id?: string; name?: string }, maxPages = 5): Promise<ApolloVisitorCompany[]> {
  const api = new ApolloClient(key);
  const found = await resolveVisitorList(key, list);
  if (!found) throw new Error("No Apollo account list for website visitors was found: save visitors to an account list with \"visitor\" in its name, or set APOLLO_VISITOR_LIST");
  const labelId = found.id;
  const out: ApolloVisitorCompany[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await api.post<{ accounts?: ({ name?: string | null; domain?: string | null; website_url?: string | null } & Record<string, unknown>)[]; pagination?: { total_pages?: number } }>("/accounts/search", {
      account_label_ids: [labelId], page, per_page: 100, sort_by_field: "account_last_activity_date", sort_ascending: false,
    });
    for (const a of r.accounts ?? []) {
      if (!a.name) continue;
      const raw = a.domain ?? a.website_url ?? null;
      const d = visitDate(a);
      out.push({ name: a.name, domain: raw ? raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : null, lastSeenAt: d.at, dateField: d.field });
    }
    if (!r.pagination?.total_pages || page >= r.pagination.total_pages) break;
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
    out.problems.push(/ 403/.test(msg) ? "This key can't read account lists: it is not a master key (Apollo › Settings › Integrations › API › set as master key)." : `Reading account lists failed: ${msg.slice(0, 200)}`);
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
}

const cleanDomain = (raw: string | null | undefined) => (raw ? raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : null);
const toOrg = (o: RawOrg): ApolloOrg | null =>
  o.name
    ? {
        name: o.name, domain: cleanDomain(o.primary_domain ?? o.website_url), industry: o.industry ?? null, employees: o.estimated_num_employees ?? null, country: o.country ?? null, keywords: (o.keywords ?? []).slice(0, 12),
        linkedinUrl: o.linkedin_url ?? null, city: o.city ?? null,
        technologies: [...new Set([...(o.technology_names ?? []), ...(o.current_technologies ?? []).map((t) => t.name ?? "")].filter(Boolean))].slice(0, 20),
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
