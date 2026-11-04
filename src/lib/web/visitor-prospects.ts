// Website visitors → Apollo prospects → Excel or the ABM pipeline.
//
// The companies seen on the website in a date range are listed (existing customers too).
// A person chooses which to enrich: Apollo finds the company and 1–2 people in the target
// roles. Prospects are stored as rows in the CSV import's own columns and checked with the
// import's own validation, so the Excel download and the pipeline import use exactly the
// structure a person would upload. Importing goes through the normal CSV import
// (ingestRows): same matching, same duplicate rules, same pipeline.

import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { seller } from "@/lib/seller";
import { activeSellerId } from "@/lib/scope";
import { companyNameKey, normalizeDomain } from "@/lib/pipeline/normalize";
import { IMPORT_FIELDS, analyzeHeaders, rowKeys, validateRow, type FieldKey } from "@/lib/import/fields";
import { findCompany, ingestRows } from "@/lib/pipeline/ingest";
import { apolloOrgEnrich, apolloProspects, type ApolloOrg, type ApolloProspect } from "@/lib/adapters/live/apollo";
import { createMockAdapters } from "@/lib/adapters/mock";
import { logEvent, newContext } from "@/lib/pipeline/context";
import { recordError } from "@/lib/admin/errors";

const DAY = 86_400_000;
const env = (name: string) => process.env[name]?.trim() || undefined;

/** The CSV import's columns, in template order: the Excel file uses exactly these. */
export const EXPORT_COLUMNS = IMPORT_FIELDS.filter((f) => f.key !== "contactName" && f.key !== "titleObservedAt").map((f) => f.label);
const LABEL = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

export type EnrichStatus = "found" | "no_match" | "no_prospects" | "failed" | "not_connected";
export type ProspectRow = Record<string, string>;

export interface VisitorCompany {
  key: string;
  name: string;
  domain: string | null;
  visits: number;
  lastVisit: Date;
  pages: string[];
  accountId: string | null;
  enrichment: { status: EnrichStatus; message: string | null; rows: ProspectRow[]; enrichedAt: Date; importedAt: Date | null } | null;
}

export const companyKey = (name: string, domain: string | null) => (domain ? `d:${domain}` : `n:${companyNameKey(name)}`);

/** Every company seen on the website in the range, newest visit first. Customers stay in the list. */
export async function listVisitorCompanies(from: Date, to: Date): Promise<VisitorCompany[]> {
  const visits = await db.webVisit.findMany({
    where: { occurredAt: { gte: from, lte: to }, OR: [{ companyName: { not: null } }, { companyDomain: { not: null } }, { accountId: { not: null } }] },
    orderBy: { occurredAt: "desc" },
    take: 5000,
  });
  const accountIds = [...new Set(visits.map((v) => v.accountId).filter((x): x is string => Boolean(x)))];
  const accounts = new Map((await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, domain: true } })).map((a) => [a.id, a]));
  const by = new Map<string, VisitorCompany>();
  for (const v of visits) {
    const acct = v.accountId ? accounts.get(v.accountId) : undefined;
    const name = acct?.name ?? v.companyName ?? v.companyDomain;
    if (!name) continue;
    const domain = acct?.domain ?? (v.companyDomain ? normalizeDomain(v.companyDomain) : null);
    const key = companyKey(name, domain);
    const c = by.get(key) ?? { key, name, domain, visits: 0, lastVisit: v.occurredAt, pages: [], accountId: acct?.id ?? null, enrichment: null };
    c.visits++;
    const page = v.title ?? v.path;
    if (page && c.pages.length < 5 && !c.pages.includes(page)) c.pages.push(page);
    by.set(key, c);
  }
  const sellerId = await activeSellerId();
  const enriched = await db.visitorEnrichment.findMany({ where: { sellerId, companyKey: { in: [...by.keys()] } } });
  for (const e of enriched) {
    const c = by.get(e.companyKey);
    if (c) c.enrichment = { status: e.status as EnrichStatus, message: e.message, rows: e.rows as ProspectRow[], enrichedAt: e.enrichedAt, importedAt: e.importedAt };
  }
  return [...by.values()];
}

/** The range from the page's ?from=&to= (YYYY-MM-DD); without one, from `defaultFrom` (or 30 days back) to today. */
export function parseRange(fromRaw: string | undefined, toRaw: string | undefined, now = new Date(), defaultFrom?: Date | null): { from: Date; to: Date } {
  const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null);
  const to = day(toRaw) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = day(fromRaw) ?? (defaultFrom ? new Date(Date.UTC(defaultFrom.getUTCFullYear(), defaultFrom.getUTCMonth(), defaultFrom.getUTCDate())) : new Date(to.getTime() - 29 * DAY));
  return from <= to ? { from, to: new Date(to.getTime() + DAY - 1) } : { from: to, to: new Date(from.getTime() + DAY - 1) };
}

/** The first identified visit in the last year: the page opens on a range that shows every visitor company. */
export async function earliestVisit(now = new Date()): Promise<Date | null> {
  const v = await db.webVisit.findFirst({ where: { occurredAt: { gte: new Date(now.getTime() - 365 * DAY) }, OR: [{ companyName: { not: null } }, { companyDomain: { not: null } }, { accountId: { not: null } }] }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } });
  return v?.occurredAt ?? null;
}

/** The roles to look for: the seller's buying-group personas, decision makers first. */
export function targetTitles(): string[] {
  const order = ["decision_maker", "budget_owner", "champion", "influencer"];
  const personas = [...seller().personas].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return [...new Set(personas.flatMap((p) => p.titles))].slice(0, 10);
}

interface Finder {
  live: boolean;
  org(domain: string): Promise<ApolloOrg | null>;
  people(domain: string, titles: string[], limit: number): Promise<ApolloProspect[]>;
}

function finder(): Finder | null {
  if (process.env.ADAPTER_MODE === "mock") {
    const p = createMockAdapters().provider;
    return {
      live: false, org: async () => null,
      people: async (d, t, n) => (await p.findByTitles(d, t, n)).map((x) => {
        const [first, ...rest] = x.fullName.split(/\s+/);
        return { firstName: first, lastName: rest.join(" ") || null, fullName: x.fullName, title: x.title, email: x.email, linkedinUrl: x.linkedinUrl, phone: null, seniority: null, department: null, location: null, companyDomain: x.companyDomain };
      }),
    };
  }
  const key = env("APOLLO_API_KEY");
  if (!key) return null;
  return { live: true, org: (d) => apolloOrgEnrich(key, d), people: async (d, t, n) => (await apolloProspects(key, d, t, n, CONFIG.visitorProspects.revealContacts)).people };
}

/** One prospect as a CSV-import row; validated with the import's own rules. Invalid cells are left blank, never guessed. */
export function toImportRow(company: { name: string; domain: string | null }, org: ApolloOrg | null, p: ApolloProspect | null, now = new Date()): ProspectRow | null {
  // Every column of the CSV import that Apollo can fill; anything Apollo doesn't give stays blank.
  const raw: Partial<Record<FieldKey, string>> = {
    company: org?.name ?? company.name,
    domain: company.domain ?? org?.domain ?? "",
    companyLinkedin: org?.linkedinUrl ?? "",
    industry: org?.industry ?? "",
    employees: org?.employees != null ? String(org.employees) : "",
    city: org?.city ?? "",
    country: org?.country ?? "",
    technologies: org?.technologies?.length ? org.technologies.slice(0, 15).join("; ") : "",
    keywords: org?.keywords.length ? org.keywords.slice(0, 8).join("; ") : "",
    dataSource: "Apollo",
    ...(p
      ? {
          firstName: p.firstName, lastName: p.lastName ?? "", title: p.title ?? "", linkedinUrl: p.linkedinUrl ?? "", email: p.email ?? "", phone: p.phone ?? "",
          department: p.department ?? "", seniority: p.seniority ?? "", location: p.location ?? "", titleObservedAt: p.title ? now.toISOString().slice(0, 10) : "",
        }
      : {}),
  };
  const row: ProspectRow = {};
  for (const [k, v] of Object.entries(raw)) if (v) row[LABEL[k as FieldKey]] = v;
  const mapping = analyzeHeaders(Object.keys(row)).mapping;
  // Drop any cell the import would reject (e.g. a country name it doesn't know), keep the rest.
  for (const label of Object.keys(row)) {
    if (label === LABEL.company || label === LABEL.firstName) continue;
    const r = validateRow({ ...row }, mapping);
    if (r.ok) break;
    if (r.error.includes(`"${row[label]}"`)) delete row[label];
  }
  return validateRow(row, analyzeHeaders(Object.keys(row)).mapping).ok ? row : null;
}

/** The HTTP status in an Apollo error ("Apollo /path 429 …"), if any. */
export function httpStatusOf(message: string): number | null {
  const m = message.match(/^Apollo \S+ (\d{3})\b/);
  return m ? Number(m[1]) : null;
}

/** Rate limits and server errors get one retry after a short pause; every attempt is recorded. */
async function withRetry<T>(fn: () => Promise<T>, attempts: { at: string; ok: boolean; status: number | null; error?: string }[]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const r = await fn();
      attempts.push({ at: new Date().toISOString(), ok: true, status: 200 });
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = httpStatusOf(msg);
      attempts.push({ at: new Date().toISOString(), ok: false, status, error: msg.slice(0, 300) });
      if (i >= 1 || !(status === 429 || (status !== null && status >= 500))) throw e;
      await new Promise((r) => setTimeout(r, status === 429 ? 3000 : 1000));
    }
  }
}

/** Find Apollo prospects for these companies and store them. Repeats only when asked (force) or after a week. */
export async function enrichCompanies(companies: { key: string; name: string; domain: string | null }[], by: string | null, opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const sellerId = await activeSellerId();
  const f = finder();
  const per = CONFIG.visitorProspects.perCompany;
  const titles = targetTitles();
  const counts: Record<EnrichStatus | "cached", number> = { found: 0, no_match: 0, no_prospects: 0, failed: 0, not_connected: 0, cached: 0 };
  // One execution id for the whole click; one event per company with what happened.
  const ctx = newContext(now);
  await logEvent(ctx, { stage: 0, step: "visitors.enrich_start", outcome: "info", reason: `Apollo enrichment started for ${companies.length} compan${companies.length === 1 ? "y" : "ies"}`, data: { by, companies: companies.length, force: Boolean(opts.force), perCompany: per } });
  for (const c of companies.slice(0, CONFIG.visitorProspects.maxPerRun)) {
    const prev = await db.visitorEnrichment.findUnique({ where: { sellerId_companyKey: { sellerId, companyKey: c.key } } });
    if (prev && prev.status !== "failed" && prev.status !== "not_connected" && !opts.force && now.getTime() - prev.enrichedAt.getTime() < 7 * DAY) {
      counts.cached++;
      await logEvent(ctx, { stage: 0, step: "visitors.enrich", outcome: "info", reason: `${c.name}: skipped, already enriched on ${prev.enrichedAt.toISOString().slice(0, 10)} (${prev.status})`, data: { company: c.name, domain: c.domain, companyKey: c.key, status: "cached", previousStatus: prev.status } });
      continue;
    }
    const attempts: { at: string; ok: boolean; status: number | null; error?: string }[] = [];
    let orgFound: boolean | null = null;
    let peopleReturned = 0;
    let status: EnrichStatus;
    let message: string | null = null;
    let rows: ProspectRow[] = [];
    if (!f) {
      status = "not_connected";
      message = "Apollo isn't connected (set APOLLO_API_KEY)";
    } else if (!c.domain) {
      status = "no_match";
      message = "No website known for this company, so Apollo can't match it reliably";
    } else {
      try {
        const org = await withRetry(() => f.org(c.domain!), attempts);
        orgFound = Boolean(org);
        if (f.live && !org) {
          status = "no_match";
          message = `Apollo has no company for ${c.domain}`;
        } else {
          const people = await withRetry(() => f.people(c.domain!, titles, per), attempts);
          peopleReturned = people.length;
          // Only people Apollo places at this company's website.
          const here = people.filter((p) => !p.companyDomain || p.companyDomain === c.domain);
          rows = here.map((p) => toImportRow(c, org, p)).filter((r): r is ProspectRow => Boolean(r));
          status = rows.length ? "found" : "no_prospects";
          if (!rows.length) {
            message = "Apollo found the company but nobody in the target roles";
            const companyOnly = toImportRow(c, org, null);
            if (companyOnly) rows = [companyOnly];
          }
        }
      } catch (e) {
        status = "failed";
        message = (e instanceof Error ? e.message : "Apollo request failed").slice(0, 300);
        // A failed retry never wipes prospects found earlier.
        if (prev) rows = prev.rows as ProspectRow[];
      }
    }
    counts[status]++;
    const lastError = [...attempts].reverse().find((a) => !a.ok);
    await logEvent(ctx, {
      stage: 0, step: "visitors.enrich", outcome: status === "failed" || status === "not_connected" ? "error" : status === "found" ? "pass" : "info",
      reason: `${c.name}: ${status}${message ? ` — ${message}` : ""}`,
      data: { company: c.name, domain: c.domain, companyKey: c.key, status, prospects: rows.filter((r) => r[LABEL.firstName]).length, peopleReturned, orgFound, titlesSearched: titles, attempts, httpStatus: lastError?.status ?? (attempts.length ? 200 : null), error: lastError?.error ?? null },
    });
    if (status === "failed") await recordError("visitors.enrich", new Error(message ?? "Apollo enrichment failed"), `${c.name} (${c.domain ?? "no domain"}) · run ${ctx.runId}`);
    const data = { companyName: c.name, domain: c.domain, status, message, rows, enrichedAt: now, enrichedBy: by };
    await db.visitorEnrichment.upsert({ where: { sellerId_companyKey: { sellerId, companyKey: c.key } }, create: { sellerId, companyKey: c.key, ...data }, update: data });
  }
  await logEvent(ctx, { stage: 0, step: "visitors.enrich_done", outcome: counts.failed ? "error" : "info", reason: `Apollo enrichment finished: ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing to do"}`, data: { ...counts, runId: ctx.runId } });
  return { ...counts, runId: ctx.runId };
}

/** Rows for the Excel file: one per prospect, company columns on every row, no duplicate people. */
export function exportRows(companies: VisitorCompany[]): ProspectRow[] {
  const seen = new Set<string>();
  const out: ProspectRow[] = [];
  for (const c of companies) {
    const rows = c.enrichment?.rows.length ? c.enrichment.rows : [{ [LABEL.company]: c.name, ...(c.domain ? { [LABEL.domain]: c.domain } : {}) }];
    for (const r of rows) {
      const v = validateRow(r, analyzeHeaders(Object.keys(r)).mapping);
      const k = v.ok ? (rowKeys(v.row).person ?? `c:${rowKeys(v.row).company}`) : JSON.stringify(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

// ── Import into the pipeline ──

export type ImportCheck = "eligible" | "customer" | "in_pipeline" | "review";

export interface ImportPreviewItem {
  key: string;
  name: string;
  domain: string | null;
  check: ImportCheck;
  reason: string;
  prospects: number;
}

/** Customers: companies marked as customers, at the customer stage or with a won deal, and the seller's listed customers. */
export async function customerCheck(name: string, domain: string | null): Promise<{ customer: boolean; inPipeline: boolean; why: string | null }> {
  const acct = await findCompany({ domain, companyLinkedin: null, nameKey: companyNameKey(name) });
  if (acct) {
    const won = await db.opportunity.count({ where: { accountId: acct.id, stage: "won" } });
    if (acct.relationship === "customer" || acct.stage === "CUSTOMER" || won) return { customer: true, inPipeline: true, why: acct.relationship === "customer" ? "Marked as a customer" : won ? "Has a won deal" : "At the customer stage" };
    // The same name with no website on either side can't be verified: a person checks it.
    return { customer: false, inPipeline: true, why: acct.domain && domain && acct.domain === domain ? "Already a company in the pipeline" : `Already in the pipeline as ${acct.name}` };
  }
  const listed = seller().customers.find((c) => companyNameKey(c.name) === companyNameKey(name));
  if (listed) return { customer: true, inPipeline: false, why: "Listed as a customer in the Account Brain" };
  return { customer: false, inPipeline: false, why: null };
}

export async function previewImport(keys: string[], from: Date, to: Date): Promise<ImportPreviewItem[]> {
  const all = await listVisitorCompanies(from, to);
  const want = new Set(keys);
  const out: ImportPreviewItem[] = [];
  for (const c of all.filter((x) => want.has(x.key))) {
    const prospects = c.enrichment?.rows.filter((r) => r[LABEL.firstName]).length ?? 0;
    const chk = await customerCheck(c.name, c.domain);
    let check: ImportCheck = "eligible";
    let reason = prospects ? `${prospects} prospect${prospects === 1 ? "" : "s"} from Apollo` : "Company only (no Apollo prospects yet)";
    if (chk.customer) [check, reason] = ["customer", chk.why!];
    else if (chk.inPipeline) [check, reason] = ["in_pipeline", chk.why!];
    else if (!c.domain) [check, reason] = ["review", "No website: customer status can't be verified"];
    out.push({ key: c.key, name: c.name, domain: c.domain, check, reason, prospects });
  }
  return out;
}

/** Import exactly these companies (and their prospects) through the normal CSV import. */
export async function importCompanies(keys: string[], from: Date, to: Date, opts: { excludeCustomers: boolean; by: string | null }) {
  const preview = await previewImport(keys, from, to);
  const skipped = preview.filter((p) => opts.excludeCustomers && p.check === "customer");
  const take = preview.filter((p) => !skipped.includes(p));
  const ctx = newContext();
  for (const p of preview) {
    const excluded = skipped.includes(p);
    await logEvent(ctx, { stage: 1, step: "visitors.import", outcome: excluded ? "block" : "info", reason: `${p.name}: ${excluded ? "excluded as an existing customer" : `selected for import (${p.check})`} — ${p.reason}`, data: { company: p.name, domain: p.domain, companyKey: p.key, check: p.check, excluded, prospects: p.prospects, by: opts.by, excludeCustomers: opts.excludeCustomers } });
  }
  if (!take.length) return { imported: 0, skipped: skipped.length, prospects: 0, batchId: null as string | null, rejected: 0, errors: [] as string[] };
  const companies = (await listVisitorCompanies(from, to)).filter((c) => take.some((t) => t.key === c.key));
  const rows = exportRows(companies);
  let res;
  try {
    res = await ingestRows(rows, { source: "website-visitor", filename: `Website visitors (Apollo) ${new Date().toISOString().slice(0, 10)}`, createdBy: opts.by, approvedBy: opts.by });
  } catch (e) {
    await logEvent(ctx, { stage: 1, step: "visitors.import_done", outcome: "error", reason: `Import failed: ${e instanceof Error ? e.message.slice(0, 300) : "unknown error"}`, data: { companies: take.length } });
    await recordError("visitors.import", e, `run ${ctx.runId}`);
    throw e;
  }
  await logEvent(ctx, { stage: 1, step: "visitors.import_done", outcome: res.rejected ? "error" : "pass", reason: `Imported ${take.length} companies (${rows.length} rows: ${res.accepted} accepted, ${res.rejected} rejected) into batch ${res.batchId}; ${skipped.length} customers excluded`, data: { batchId: res.batchId, accepted: res.accepted, rejected: res.rejected, errors: res.errors.slice(0, 20), companies: take.map((t) => t.name), excluded: skipped.map((t) => t.name) } });
  const sellerId = await activeSellerId();
  await db.visitorEnrichment.updateMany({ where: { sellerId, companyKey: { in: take.map((t) => t.key) } }, data: { importedAt: new Date(), importBatchId: res.batchId, importedBy: opts.by } });
  // Earlier website visits by these companies now count for them.
  for (const c of companies) {
    const acct = await findCompany({ domain: c.domain, companyLinkedin: null, nameKey: companyNameKey(c.name) });
    if (acct) await db.webVisit.updateMany({ where: { accountId: null, OR: [...(c.domain ? [{ companyDomain: c.domain }] : []), { companyName: c.name }] }, data: { accountId: acct.id } });
  }
  return { imported: take.length, skipped: skipped.length, prospects: rows.filter((r) => r[LABEL.firstName]).length, batchId: res.batchId, rejected: res.rejected, errors: res.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.error}`) };
}
