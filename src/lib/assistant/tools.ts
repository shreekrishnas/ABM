// The Super Admin assistant's evidence: read-only lookups over the platform's own records.
// Every tool is a bounded SELECT (no writes, no workflow calls), returns at most a few
// dozen rows, and its output is redacted before any of it reaches the AI model.

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { serviceStatus } from "@/lib/adapters";
import { companyNameKey } from "@/lib/pipeline/normalize";

const DAY = 86_400_000;
const MAX = 50;

// ── Redaction ──

const SECRET = /\b(sk-[A-Za-z0-9_-]{10,}|sk_[A-Za-z0-9_]{10,}|xox[abp]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|AKIA[0-9A-Z]{16})\b/g;
const KEYED = /((?:api[_-]?key|apikey|token|secret|password|authorization|x-api-key|bearer)["'\s:=]+)([^\s"',&\[\]]{6,})/gi;
const URL_CRED = /(\/\/)[^/\s:@]+:[^/\s@]+@/g;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;
const SENSITIVE_KEY = /^(password|passwordHash|secret|token|apiKey|key|authorization|cookie|session|emailHash|phone|personalEmail)$/i;

export function redactText(s: string): string {
  return s.replace(SECRET, "[redacted]").replace(KEYED, "$1[removed]").replace(URL_CRED, "$1[credentials removed]@").replace(EMAIL, "$1…@$2").replace(PHONE, "[phone removed]");
}

export function redact(v: unknown, depth = 0): unknown {
  if (v == null || depth > 6) return v ?? null;
  if (typeof v === "string") return redactText(v.length > 600 ? `${v.slice(0, 600)}…` : v);
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.slice(0, MAX).map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? "[removed]" : redact(x, depth + 1);
    return out;
  }
  return v;
}

// ── Arguments ──

const since = (days: number | undefined, from: string | undefined) => (from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(Date.now() - (days ?? 7) * DAY));
const until = (to: string | undefined) => (to && !Number.isNaN(Date.parse(to)) ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to) : new Date());
const Range = { days: z.number().int().min(1).max(365).optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional() };
const lim = (n: number | undefined, max = MAX) => Math.min(Math.max(n ?? 20, 1), max);

async function companiesMatching(q: string, take = 10) {
  const key = companyNameKey(q);
  return db.account.findMany({
    where: { mergedIntoId: null, OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q.toLowerCase() } }, ...(key ? [{ nameKey: key }] : [])] },
    select: { id: true, name: true, domain: true, sellerId: true, relationship: true, stage: true, pipelineStatus: true, tier: true, disqualifyReason: true, source: true, addedBy: true, addedVia: true, approvedBy: true, lastImportBatchId: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take,
  });
}

// ── Tools ──

interface Tool {
  description: string;
  args: z.ZodTypeAny;
  run: (a: never) => Promise<unknown>;
}

const tool = <S extends z.ZodTypeAny>(description: string, args: S, run: (a: z.infer<S>) => Promise<unknown>): Tool => ({ description, args, run: run as (a: never) => Promise<unknown> });

export const TOOLS: Record<string, Tool> = {
  find_companies: tool(
    "Companies in the pipeline whose name or website matches q: id, website, client (sellerId), relationship (prospect/customer), buying stage, pipelineStatus, tier, why excluded (disqualifyReason), how it was added and by whom, last import batch.",
    z.object({ q: z.string().min(2).max(100) }),
    async ({ q }) => companiesMatching(q),
  ),

  company_history: tool(
    "Everything recorded for one company (by accountId): the company row, counts of people/drafts/messages, its pipeline events (newest first, optionally only a step prefix), open review items, Apollo visitor enrichment, website visits and the import batches that touched it.",
    z.object({ accountId: z.string().min(5).max(40), step: z.string().max(60).optional(), limit: z.number().int().optional(), ...Range }),
    async ({ accountId, step, limit, days, from, to }) => {
      const a = await db.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, domain: true, sellerId: true, relationship: true, stage: true, pipelineStatus: true, tier: true, fitScore: true, disqualifyReason: true, source: true, addedBy: true, addedVia: true, approvedBy: true, lastImportBatchId: true, createdAt: true, updatedAt: true, mergedIntoId: true } });
      if (!a) return { found: false, accountId };
      const [people, drafts, events, reviews, visits, enrichment, batches] = await Promise.all([
        db.contact.count({ where: { accountId } }),
        db.draft.groupBy({ by: ["status"], where: { contact: { accountId } }, _count: true }),
        db.pipelineEvent.findMany({ where: { accountId, ...(step ? { step: { startsWith: step } } : {}), createdAt: { gte: since(days ?? 90, from), lte: until(to) } }, orderBy: { createdAt: "desc" }, take: lim(limit, 60), select: { id: true, createdAt: true, stage: true, step: true, outcome: true, reason: true, runId: true, data: true } }),
        db.reviewItem.findMany({ where: { accountId, status: "open" }, select: { id: true, type: true, reason: true, createdAt: true }, take: 10 }),
        db.webVisit.count({ where: { accountId } }),
        db.visitorEnrichment.findMany({ where: { OR: [...(a.domain ? [{ domain: a.domain }] : []), { companyName: a.name }] }, select: { status: true, message: true, enrichedAt: true, enrichedBy: true, importedAt: true, importBatchId: true, rows: true } }),
        db.importBatch.findMany({ where: { id: { in: [a.lastImportBatchId].filter((x): x is string => Boolean(x)) } }, select: { id: true, filename: true, source: true, status: true, rows: true, accepted: true, rejected: true, createdBy: true, createdAt: true } }),
      ]);
      return { company: a, people, drafts, websiteVisits: visits, openReviews: reviews, visitorEnrichment: enrichment.map((e) => ({ ...e, prospects: Array.isArray(e.rows) ? (e.rows as Record<string, string>[]).filter((r) => r["First Name"]).length : 0, rows: undefined })), lastImportBatch: batches[0] ?? null, events };
    },
  ),

  pipeline_events: tool(
    "Structured execution log (PipelineEvent). Filter by step prefix (e.g. 'visitors.enrich', 'apollo.visitors', 'orchestrator', 'fit_tier', 'discover', 'lookalike', 'company_profile', 'buying_group', 'draft_review', 'sequence_send'), outcome (pass|block|info|error), runId (execution id), accountId, text in the reason, and a date range. Newest first.",
    z.object({ step: z.string().max(60).optional(), outcome: z.enum(["pass", "block", "info", "error"]).optional(), runId: z.string().max(60).optional(), accountId: z.string().max(40).optional(), text: z.string().max(100).optional(), limit: z.number().int().optional(), ...Range }),
    async ({ step, outcome, runId, accountId, text, limit, days, from, to }) =>
      db.pipelineEvent.findMany({
        where: { ...(step ? { step: { startsWith: step } } : {}), ...(outcome ? { outcome } : {}), ...(runId ? { runId } : {}), ...(accountId ? { accountId } : {}), ...(text ? { reason: { contains: text, mode: "insensitive" } } : {}), ...(runId ? {} : { createdAt: { gte: since(days, from), lte: until(to) } }) },
        orderBy: { createdAt: "desc" },
        take: lim(limit),
        select: { id: true, createdAt: true, stage: true, step: true, outcome: true, reason: true, runId: true, accountId: true, data: true, account: { select: { name: true, domain: true } } },
      }),
  ),

  event_counts: tool(
    "Counts of execution-log events grouped by step and outcome in a date range (optionally only a step prefix). Use for 'how many … failed this week'.",
    z.object({ step: z.string().max(60).optional(), ...Range }),
    async ({ step, days, from, to }) => {
      const rows = await db.pipelineEvent.groupBy({ by: ["step", "outcome"], where: { ...(step ? { step: { startsWith: step } } : {}), createdAt: { gte: since(days, from), lte: until(to) } }, _count: true, orderBy: { _count: { step: "desc" } }, take: 80 });
      return rows.map((r) => ({ step: r.step, outcome: r.outcome, count: r._count }));
    },
  ),

  import_batches: tool(
    "CSV/Excel/API/website-visitor/discovery imports (ImportBatch): file name, source, status (uploading|processing|done|failed), rows, accepted, rejected, first row errors, stats (companies/people created or updated, duplicates), who started it. Filter by source, status, or only ones with rejected rows.",
    z.object({ source: z.string().max(40).optional(), status: z.string().max(20).optional(), withErrors: z.boolean().optional(), limit: z.number().int().optional(), ...Range }),
    async ({ source, status, withErrors, limit, days, from, to }) => {
      const rows = await db.importBatch.findMany({
        where: { ...(source ? { source } : {}), ...(status ? { status } : {}), ...(withErrors ? { rejected: { gt: 0 } } : {}), createdAt: { gte: since(days, from), lte: until(to) } },
        orderBy: { createdAt: "desc" },
        take: lim(limit, 30),
        select: { id: true, sellerId: true, filename: true, source: true, status: true, rows: true, accepted: true, rejected: true, errors: true, stats: true, ignoredColumns: true, toProcess: true, processed: true, createdBy: true, createdAt: true, finishedAt: true },
      });
      return rows.map((b) => ({ ...b, errors: Array.isArray(b.errors) ? (b.errors as unknown[]).slice(0, 10) : b.errors, errorCount: Array.isArray(b.errors) ? (b.errors as unknown[]).length : 0 }));
    },
  ),

  import_batch_companies: tool(
    "The companies an import batch created or updated (by batchId), with their current pipeline status and exclusion reason.",
    z.object({ batchId: z.string().min(5).max(40) }),
    async ({ batchId }) => db.account.findMany({ where: { lastImportBatchId: batchId }, select: { id: true, name: true, domain: true, relationship: true, stage: true, pipelineStatus: true, disqualifyReason: true, createdAt: true }, take: MAX }),
  ),

  visitor_companies: tool(
    "Website visits by company in a date range (WebVisit): visits, sources (apollo|reverse_ip|tracking_script|email_link), last visit, and whether the company is in the pipeline.",
    z.object({ q: z.string().max(100).optional(), ...Range }),
    async ({ q, days, from, to }) => {
      const rows = await db.webVisit.groupBy({
        by: ["companyName", "companyDomain", "accountId", "source"],
        where: { occurredAt: { gte: since(days ?? 30, from), lte: until(to) }, ...(q ? { OR: [{ companyName: { contains: q, mode: "insensitive" } }, { companyDomain: { contains: q.toLowerCase() } }] } : {}) },
        _count: true,
        _max: { occurredAt: true },
        orderBy: { _count: { companyName: "desc" } },
        take: 80,
      });
      return rows.map((r) => ({ company: r.companyName, domain: r.companyDomain, accountId: r.accountId, source: r.source, visits: r._count, lastVisit: r._max.occurredAt }));
    },
  ),

  visitor_enrichments: tool(
    "Apollo prospect enrichment of website-visitor companies (latest state per company): status found|no_prospects|no_match|failed|not_connected, message, prospects found, when and by whom, and whether/when it was imported (with import batch). Filter by status, company text, or date range of the enrichment. For per-attempt detail (HTTP status, retries, execution id) use pipeline_events with step 'visitors.enrich'.",
    z.object({ status: z.string().max(20).optional(), q: z.string().max(100).optional(), limit: z.number().int().optional(), ...Range }),
    async ({ status, q, limit, days, from, to }) => {
      const rows = await db.visitorEnrichment.findMany({
        where: { ...(status ? { status } : {}), ...(q ? { OR: [{ companyName: { contains: q, mode: "insensitive" } }, { domain: { contains: q.toLowerCase() } }] } : {}), enrichedAt: { gte: since(days ?? 30, from), lte: until(to) } },
        orderBy: { enrichedAt: "desc" },
        take: lim(limit),
      });
      return rows.map((r) => ({ company: r.companyName, domain: r.domain, sellerId: r.sellerId, status: r.status, message: r.message, prospects: Array.isArray(r.rows) ? (r.rows as Record<string, string>[]).filter((x) => x["First Name"]).length : 0, enrichedAt: r.enrichedAt, enrichedBy: r.enrichedBy, importedAt: r.importedAt, importBatchId: r.importBatchId, importedBy: r.importedBy }));
    },
  ),

  visitor_funnel: tool(
    "Reconciled funnel for website-visitor companies in a date range: companies seen, enrichment outcomes, imported, excluded as customers, already in pipeline, never enriched, never imported. Every company is in exactly one outcome bucket; lists the companies per bucket.",
    z.object({ ...Range }),
    async ({ days, from, to }) => {
      const gte = since(days ?? 30, from);
      const lte = until(to);
      const visits = await db.webVisit.findMany({ where: { occurredAt: { gte, lte } }, select: { companyName: true, companyDomain: true, accountId: true }, take: 5000 });
      const companies = new Map<string, { name: string; domain: string | null; accountId: string | null }>();
      for (const v of visits) {
        const name = v.companyName ?? v.companyDomain;
        if (!name && !v.accountId) continue;
        const key = v.companyDomain ? `d:${v.companyDomain}` : v.accountId ? `a:${v.accountId}` : `n:${companyNameKey(name!)}`;
        if (!companies.has(key)) companies.set(key, { name: name ?? "(known company)", domain: v.companyDomain, accountId: v.accountId });
      }
      const enr = await db.visitorEnrichment.findMany({ where: { OR: [{ domain: { in: [...companies.values()].map((c) => c.domain).filter((d): d is string => Boolean(d)) } }, { companyName: { in: [...companies.values()].map((c) => c.name) } }] } });
      const importEvents = await db.pipelineEvent.findMany({ where: { step: "visitors.import", createdAt: { gte } }, select: { data: true, createdAt: true, runId: true } });
      const excludedKeys = new Set(importEvents.filter((e) => (e.data as { excluded?: boolean } | null)?.excluded).map((e) => (e.data as { companyKey: string }).companyKey));
      const buckets: Record<string, string[]> = { imported: [], excluded_customer: [], enriched_not_imported: [], enrichment_failed: [], no_apollo_match: [], no_prospects_found: [], not_enriched_already_in_pipeline: [], not_enriched: [] };
      for (const [key, c] of companies) {
        const e = enr.find((x) => (c.domain && x.domain === c.domain) || x.companyName === c.name);
        const label = `${c.name}${c.domain ? ` (${c.domain})` : ""}`;
        if (e?.importedAt) buckets.imported.push(label);
        else if (excludedKeys.has(key) || (e && excludedKeys.has(e.companyKey))) buckets.excluded_customer.push(label);
        else if (e?.status === "found") buckets.enriched_not_imported.push(label);
        else if (e?.status === "failed" || e?.status === "not_connected") buckets.enrichment_failed.push(`${label}: ${e.message ?? e.status}`);
        else if (e?.status === "no_match") buckets.no_apollo_match.push(label);
        else if (e?.status === "no_prospects") buckets.no_prospects_found.push(label);
        else if (c.accountId) buckets.not_enriched_already_in_pipeline.push(label);
        else buckets.not_enriched.push(label);
      }
      return { range: { from: gte, to: lte }, companiesSeen: companies.size, counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])), companies: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.slice(0, 40)])), note: "Buckets are exclusive and sum to companiesSeen. Import rejections per row are in import_batches (source website-visitor)." };
    },
  ),

  suggestions: tool(
    "Discovery suggestions (ProspectSuggestion) from the market scan, lookalikes, AI company search (discovery) and website visitors: status new|added|dismissed|excluded|needs_check|watching, reason, score, who requested/decided. Filter by origin, status, company text.",
    z.object({ origin: z.string().max(30).optional(), status: z.string().max(20).optional(), q: z.string().max(100).optional(), limit: z.number().int().optional(), ...Range }),
    async ({ origin, status, q, limit, days, from, to }) =>
      db.prospectSuggestion.findMany({
        where: { ...(origin ? { origin } : {}), ...(status ? { status } : {}), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}), updatedAt: { gte: since(days ?? 30, from), lte: until(to) } },
        orderBy: { updatedAt: "desc" },
        take: lim(limit),
        select: { id: true, sellerId: true, origin: true, name: true, domain: true, status: true, reason: true, score: true, level: true, whyNow: true, researchStatus: true, requestedBy: true, decidedBy: true, decidedAt: true, accountId: true, createdAt: true, updatedAt: true },
      }),
  ),

  review_items: tool(
    "Items waiting for a person (ReviewItem): type, status, reason, company. Filter by status (open|resolved…) and type.",
    z.object({ status: z.string().max(20).optional(), type: z.string().max(40).optional(), limit: z.number().int().optional(), ...Range }),
    async ({ status, type, limit, days, from, to }) =>
      db.reviewItem.findMany({
        where: { ...(status ? { status: status as Prisma.EnumReviewStatusFilter["equals"] } : {}), ...(type ? { type: type as Prisma.EnumReviewTypeFilter["equals"] } : {}), createdAt: { gte: since(days ?? 30, from), lte: until(to) } },
        orderBy: { createdAt: "desc" },
        take: lim(limit),
        select: { id: true, type: true, status: true, reason: true, stage: true, createdAt: true, resolvedAt: true, resolution: true, account: { select: { id: true, name: true } } },
      }),
  ),

  errors: tool(
    "Server errors kept by the platform (ErrorLog), grouped by place and message with a count, first and last seen. Filter by source text.",
    z.object({ source: z.string().max(60).optional(), ...Range }),
    async ({ source, days, from, to }) =>
      db.errorLog.findMany({ where: { ...(source ? { source: { contains: source } } : {}), lastSeen: { gte: since(days, from), lte: until(to) } }, orderBy: { lastSeen: "desc" }, take: 30, select: { source: true, message: true, detail: true, count: true, firstSeen: true, lastSeen: true } }),
  ),

  integrations: tool(
    "Which integrations are connected (live / mock / off) and how (no secrets), plus errors per integration-related step in the date range.",
    z.object({ ...Range }),
    async ({ days, from, to }) => {
      const steps = ["apollo.", "visitors.enrich", "enrichment.paid_lookup", "company_profile.error", "research_plan.not_connected", "orchestrator.error", "discover.", "lookalike."];
      const errs = await db.pipelineEvent.groupBy({ by: ["step"], where: { outcome: "error", createdAt: { gte: since(days, from), lte: until(to) }, OR: steps.map((s) => ({ step: { startsWith: s } })) }, _count: true });
      return { services: serviceStatus().map((s) => ({ service: s.label, mode: s.mode, via: s.via })), errorsByStep: errs.map((e) => ({ step: e.step, errors: e._count })) };
    },
  ),

  jobs: tool(
    "Background jobs: each job lease with its last run time and last result (queue drain, scans), plus the latest scheduled-run events (tick, apollo.visitors, discover.scan).",
    z.object({}),
    async () => {
      const [leases, recent] = await Promise.all([
        db.jobLease.findMany({ select: { name: true, holder: true, expiresAt: true, lastRunAt: true, lastResult: true, updatedAt: true } }),
        db.pipelineEvent.findMany({ where: { OR: [{ step: { startsWith: "apollo.visitors" } }, { step: { startsWith: "discover.scan" } }, { step: { startsWith: "orchestrator." } }] }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, step: true, outcome: true, reason: true, runId: true } }),
      ]);
      return { leases, recent };
    },
  ),

  audit_log: tool(
    "Who did what (AuditEntry): actor, action (e.g. suggestion.approve, visitors.import, settings changes, user/role changes, pack edits), target and when. Filter by action prefix and actor.",
    z.object({ action: z.string().max(60).optional(), actor: z.string().max(100).optional(), limit: z.number().int().optional(), ...Range }),
    async ({ action, actor, limit, days, from, to }) =>
      db.auditEntry.findMany({ where: { ...(action ? { action: { startsWith: action } } : {}), ...(actor ? { actorEmail: { contains: actor } } : {}), createdAt: { gte: since(days, from), lte: until(to) } }, orderBy: { createdAt: "desc" }, take: lim(limit), select: { createdAt: true, actorEmail: true, action: true, target: true, clientId: true, before: true, after: true } }),
  ),

  pipeline_counts: tool(
    "Totals: companies created in the range (by source and by client), companies by pipelineStatus and relationship (customers), people created, drafts by status, LinkedIn messages by status.",
    z.object({ ...Range }),
    async ({ days, from, to }) => {
      const range = { gte: since(days, from), lte: until(to) };
      const [bySource, byStatus, byRel, people, drafts, linkedin] = await Promise.all([
        db.account.groupBy({ by: ["source", "sellerId"], where: { createdAt: range, mergedIntoId: null }, _count: true }),
        db.account.groupBy({ by: ["pipelineStatus"], where: { mergedIntoId: null }, _count: true }),
        db.account.groupBy({ by: ["relationship"], where: { mergedIntoId: null }, _count: true }),
        db.contact.count({ where: { createdAt: range } }),
        db.draft.groupBy({ by: ["status"], where: { createdAt: range }, _count: true }),
        db.linkedInMessage.groupBy({ by: ["status", "direction"], where: { createdAt: range }, _count: true }),
      ]);
      return { createdInRange: bySource.map((r) => ({ source: r.source, client: r.sellerId, companies: r._count })), peopleCreatedInRange: people, allCompaniesByPipelineStatus: byStatus.map((r) => ({ status: r.pipelineStatus, n: r._count })), allCompaniesByRelationship: byRel.map((r) => ({ relationship: r.relationship, n: r._count })), draftsInRange: drafts.map((r) => ({ status: r.status, n: r._count })), linkedinMessagesInRange: linkedin.map((r) => ({ status: r.status, direction: r.direction, n: r._count })) };
    },
  ),

  incomplete_people: tool(
    "People missing key details (no LinkedIn URL and no email, or no job title), optionally for one company or client.",
    z.object({ accountId: z.string().max(40).optional(), sellerId: z.string().max(40).optional(), limit: z.number().int().optional() }),
    async ({ accountId, sellerId, limit }) => {
      const where: Prisma.ContactWhereInput = { mergedIntoId: null, ...(accountId ? { accountId } : {}), ...(sellerId ? { account: { sellerId } } : {}), OR: [{ AND: [{ linkedinUrl: null }, { email: null }] }, { title: null }] };
      const [total, rows] = await Promise.all([db.contact.count({ where }), db.contact.findMany({ where, take: lim(limit), select: { id: true, fullName: true, title: true, linkedinUrl: true, email: true, account: { select: { id: true, name: true } } } })]);
      return { total, people: rows.map((r) => ({ id: r.id, name: r.fullName, company: r.account?.name, accountId: r.account?.id, missing: [!r.title && "job title", !r.linkedinUrl && !r.email && "LinkedIn URL and email"].filter(Boolean) })) };
    },
  ),

  spend: tool(
    "Recorded costs (LedgerEntry) in the range by kind (search, llm, lookup…) and by client, in USD.",
    z.object({ ...Range }),
    async ({ days, from, to }) => {
      const rows = await db.ledgerEntry.groupBy({ by: ["kind", "sellerId"], where: { createdAt: { gte: since(days, from), lte: until(to) } }, _sum: { amountMicros: true }, _count: true });
      return rows.map((r) => ({ kind: r.kind, client: r.sellerId, entries: r._count, usd: Math.round((r._sum.amountMicros ?? 0) / 10_000) / 100 }));
    },
  ),
};

export const TOOL_NAMES = Object.keys(TOOLS);

export function toolCatalog(): string {
  return Object.entries(TOOLS).map(([name, t]) => `- ${name}: ${t.description} Args (JSON): ${describeArgs(t.args)}`).join("\n");
}

function describeArgs(s: z.ZodTypeAny): string {
  const shape = (s as z.ZodObject<z.ZodRawShape>).shape as Record<string, z.ZodTypeAny> | undefined;
  if (!shape) return "{}";
  return `{ ${Object.entries(shape).map(([k, v]) => `${k}${v.isOptional() ? "?" : ""}`).join(", ")} } (days = look back N days, default 7; from/to = YYYY-MM-DD)`;
}

/** Run one tool with validated arguments, a time limit and redacted output. Never throws. */
export async function runTool(name: string, args: unknown): Promise<{ ok: boolean; rows: number; result: unknown }> {
  const t = TOOLS[name];
  if (!t) return { ok: false, rows: 0, result: `Unknown tool ${name}` };
  const parsed = t.args.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, rows: 0, result: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  try {
    const result = await Promise.race([t.run(parsed.data as never), new Promise((_, rej) => setTimeout(() => rej(new Error("query took longer than 15 s")), 15_000))]);
    return { ok: true, rows: Array.isArray(result) ? result.length : 1, result: redact(result) };
  } catch (e) {
    return { ok: false, rows: 0, result: `Lookup failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}
