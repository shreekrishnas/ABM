// Stage 1 — Data Input ("Import Companies & People"). One CSV creates linked company
// and person records, assigns the selected campaign and sender profile, and
// initializes each person's journey and current stage.
//
// Built for regular re-uploads (weekly or more): rows are UPSERTED, not appended.
//   • Companies match on website/domain, then company LinkedIn URL, then normalized name.
//   • People match on LinkedIn URL, then email, then full name within the company.
//   • Journeys are unique per person + campaign + sender: the same list for Sender 2
//     reuses the company and person and creates only Sender 2's journey.
//   • Non-blank values from the newest file win; blank cells never erase data.
//   • Only fields that actually changed lose their verified status and get re-checked.
//   • Anything new or changed is queued for an automatic pipeline run; unchanged
//     companies are left alone (no repeated spend).
//   • People erased under GDPR are never re-imported; unsubscribed people stay suppressed.

import { z } from "zod";
import type { Account, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { analyzeHeaders, validateRow, type ActivityRow, type CleanRow, type FieldKey } from "@/lib/import/fields";
import { companyNameKey, inferFunction, inferSeniority, standardizeTitle } from "./normalize";
import { setAccountField, setContactField } from "./fields";
import { sha256 } from "./crypto";
import { classifyReplyRules, type Activity } from "@/lib/journey/engine";
import { ensureJourney, recordActivities } from "@/lib/journey/service";

/** API rows: any object; columns are mapped and validated against the template. */
export const IngestRow = z.record(z.string(), z.unknown());

export interface BatchStats {
  accountsCreated: number;
  accountsUpdated: number;
  accountsUnchanged: number;
  contactsCreated: number;
  contactsUpdated: number;
  contactsUnchanged: number;
  skippedErased: number;
  journeysCreated: number;
  journeysUpdated: number;
  duplicatesInFile: number;
}

export const emptyStats = (): BatchStats => ({ accountsCreated: 0, accountsUpdated: 0, accountsUnchanged: 0, contactsCreated: 0, contactsUpdated: 0, contactsUnchanged: 0, skippedErased: 0, journeysCreated: 0, journeysUpdated: 0, duplicatesInFile: 0 });

const MAX_STORED_ERRORS = 500;

export interface BatchOptions {
  filename: string;
  source: string;
  rows: number;
  ignoredColumns?: string[];
  campaignId?: string | null;
  senderId?: string | null;
  mapping?: Record<string, FieldKey>;
}

export async function startBatch(opts: BatchOptions) {
  await backfillNameKeys();
  return db.importBatch.create({
    data: {
      filename: opts.filename, source: opts.source, status: "uploading", rows: opts.rows, accepted: 0, rejected: 0, errors: [], stats: emptyStats() as unknown as Prisma.InputJsonValue,
      ignoredColumns: opts.ignoredColumns ?? [], campaignId: opts.campaignId ?? null, senderId: opts.senderId ?? null, mapping: (opts.mapping ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Companies created before name matching existed get their key once. */
async function backfillNameKeys() {
  const missing = await db.account.findMany({ where: { nameKey: null }, select: { id: true, name: true }, take: 5000 });
  for (const a of missing) await db.account.update({ where: { id: a.id }, data: { nameKey: companyNameKey(a.name) } });
}

type AccountOutcome = "created" | "updated" | "unchanged";
type ContactOutcome = "created" | "updated" | "unchanged" | "none" | "erased";
type JourneyOutcome = "created" | "updated" | "unchanged" | "none";

/** Website first, then company LinkedIn URL, then normalized name. */
export async function findCompany(r: Pick<CleanRow, "domain" | "companyLinkedin" | "nameKey">): Promise<Account | null> {
  let a: Account | null = r.domain ? await db.account.findUnique({ where: { domain: r.domain } }) : null;
  if (!a && r.companyLinkedin) a = await db.account.findFirst({ where: { linkedinUrl: r.companyLinkedin, mergedIntoId: null } });
  if (!a && r.nameKey) {
    // Same name with a DIFFERENT website is a different company (e.g. a subsidiary).
    a = await db.account.findFirst({ where: { nameKey: r.nameKey, mergedIntoId: null, ...(r.domain ? { OR: [{ domain: null }, { domain: r.domain }] } : {}) }, orderBy: { createdAt: "asc" } });
  }
  if (a?.mergedIntoId) a = await db.account.findUnique({ where: { id: a.mergedIntoId } });
  return a;
}

/** LinkedIn URL first, then email, then full name within the company. */
export async function findPerson(p: { linkedinUrl: string | null; email: string | null; fullName: string }, accountId: string | null) {
  if (p.linkedinUrl) {
    const c = await db.contact.findFirst({ where: { linkedinUrl: p.linkedinUrl, mergedIntoId: null } });
    if (c) return c;
  }
  if (p.email) {
    const c = await db.contact.findFirst({ where: { email: { equals: p.email, mode: "insensitive" }, mergedIntoId: null } });
    if (c) return c;
  }
  if (!accountId) return null;
  // Same name at the same company — unless both have LinkedIn URLs and they differ (two different people).
  return db.contact.findFirst({
    where: { accountId, mergedIntoId: null, fullName: { equals: p.fullName, mode: "insensitive" }, ...(p.linkedinUrl ? { OR: [{ linkedinUrl: null }, { linkedinUrl: p.linkedinUrl }] } : {}) },
  });
}

interface RowContext {
  source: string;
  batchId: string;
  filename: string;
  campaignId: string | null;
  senderId: string | null;
  now: Date;
}

async function upsertRow(r: CleanRow, ctx: RowContext): Promise<{ accountId: string; account: AccountOutcome; contact: ContactOutcome; journey: JourneyOutcome; changes: string[] }> {
  const changes: string[] = [];
  const source = r.dataSource ?? ctx.source;

  // ── Company ──
  let account = await findCompany(r);
  let accountOutcome: AccountOutcome = "unchanged";
  if (!account) {
    account = await db.account.create({
      data: {
        name: r.company, nameKey: r.nameKey, domain: r.domain, linkedinUrl: r.companyLinkedin, industry: r.industry, employees: r.employees, city: r.city, country: r.country,
        technologies: r.technologies ?? [], keywords: r.keywords ?? [], companyNotes: r.companyNotes, source,
      },
    });
    accountOutcome = "created";
    for (const [field, value] of [["domain", r.domain], ["industry", r.industry], ["employees", r.employees?.toString() ?? null], ["country", r.country]] as const) {
      if (value) await setAccountField(account.id, field, { value, status: "unknown", source });
    }
  } else {
    const a = account;
    const data: Prisma.AccountUpdateInput = {};
    if (r.domain && !a.domain && !(await db.account.findUnique({ where: { domain: r.domain } }))) data.domain = r.domain;
    if (r.companyLinkedin && r.companyLinkedin !== a.linkedinUrl) data.linkedinUrl = r.companyLinkedin;
    if (r.industry && r.industry !== a.industry) data.industry = r.industry;
    if (r.employees != null && r.employees !== a.employees) data.employees = r.employees;
    if (r.city && r.city !== a.city) data.city = r.city;
    if (r.country && r.country !== a.country) data.country = r.country;
    if (r.companyNotes && r.companyNotes !== a.companyNotes) data.companyNotes = r.companyNotes;
    if (!a.nameKey) data.nameKey = r.nameKey;
    // Tech stack and keywords accumulate across uploads (new ones added, none removed).
    const newTech = (r.technologies ?? []).filter((t) => !a.technologies.some((x) => x.toLowerCase() === t.toLowerCase()));
    if (newTech.length) data.technologies = [...a.technologies, ...newTech];
    const newKw = (r.keywords ?? []).filter((t) => !a.keywords.some((x) => x.toLowerCase() === t.toLowerCase()));
    if (newKw.length) data.keywords = [...a.keywords, ...newKw];
    const changed = Object.keys(data).filter((k) => k !== "nameKey");
    if (Object.keys(data).length) account = await db.account.update({ where: { id: a.id }, data });
    if (changed.length) {
      accountOutcome = "updated";
      for (const f of changed) {
        if (f === "domain" || f === "industry" || f === "employees" || f === "country") await setAccountField(account.id, f, { value: account[f]?.toString() ?? null, status: "unknown", source });
        changes.push(f === "technologies" ? `tech stack +${newTech.join(", ")}` : f === "keywords" ? `keywords +${newKw.join(", ")}` : f);
      }
    }
  }

  // ── Person ──
  let contactOutcome: ContactOutcome = "none";
  let journeyOutcome: JourneyOutcome = "none";
  const p = r.person;
  if (p) {
    if (p.email) {
      const erased = await db.suppression.findUnique({ where: { value: `sha256:${sha256(p.email)}` } });
      if (erased) return { accountId: account.id, account: accountOutcome, contact: "erased", journey: "none", changes };
    }
    const existing = await findPerson(p, account.id);
    const suppressed = p.email ? Boolean(await db.suppression.findUnique({ where: { value: p.email } })) : false;
    let contactId: string;

    if (!existing) {
      const title = standardizeTitle(p.title);
      const c = await db.contact.create({
        data: {
          accountId: account.id, fullName: p.fullName, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, title: p.title,
          titleNormalized: title, function: inferFunction(p.department ? `${p.department} ${title ?? ""}` : title), seniority: p.seniority?.toLowerCase() ?? inferSeniority(title),
          department: p.department, location: p.location, personNotes: p.notes, linkedinUrl: p.linkedinUrl,
          country: account.country, source, state: suppressed ? "suppressed" : "new",
        },
      });
      for (const [field, value] of [["email", p.email], ["title", p.title], ["phone", p.phone], ["linkedin", p.linkedinUrl], ["company", account.domain ?? account.name]] as const) {
        if (value) await setContactField(c.id, field, { value, status: "unknown", source, observedAt: field === "title" ? p.titleObservedAt : null });
      }
      contactId = c.id;
      contactOutcome = "created";
    } else {
      contactId = existing.id;
      const data: Prisma.ContactUpdateInput = {};
      const reset: [string, string | null][] = [];
      if (existing.accountId !== account.id) {
        // Same person (LinkedIn URL or email) now listed at another company: move them, verify again.
        data.account = { connect: { id: account.id } };
        reset.push(["company", account.domain ?? account.name]);
      }
      if (p.email && p.email !== existing.email?.toLowerCase()) {
        data.email = p.email;
        reset.push(["email", p.email]);
      }
      if (p.title && p.title !== existing.title) {
        const title = standardizeTitle(p.title);
        Object.assign(data, { title: p.title, titleNormalized: title, function: inferFunction(title), seniority: p.seniority?.toLowerCase() ?? inferSeniority(title), buyingRole: "unknown" });
        reset.push(["title", p.title]);
      }
      if (p.phone && p.phone !== existing.phone) {
        data.phone = p.phone;
        reset.push(["phone", p.phone]);
      }
      if (p.linkedinUrl && p.linkedinUrl !== existing.linkedinUrl) {
        data.linkedinUrl = p.linkedinUrl;
        reset.push(["linkedin", p.linkedinUrl]);
      }
      const soft: Record<string, string | null> = {};
      if (p.firstName && p.firstName !== existing.firstName) soft.firstName = p.firstName;
      if (p.lastName && p.lastName !== existing.lastName) soft.lastName = p.lastName;
      if ((soft.firstName || soft.lastName) && p.fullName !== existing.fullName) soft.fullName = p.fullName;
      if (p.department && p.department !== existing.department) soft.department = p.department;
      if (p.location && p.location !== existing.location) soft.location = p.location;
      if (p.notes && p.notes !== existing.personNotes) soft.personNotes = p.notes;
      if (p.seniority && p.seniority.toLowerCase() !== existing.seniority) soft.seniority = p.seniority.toLowerCase();
      Object.assign(data, soft);
      if (suppressed && existing.state !== "suppressed") data.state = "suppressed";
      if (Object.keys(data).length) {
        // A changed person must be verified again before any outreach.
        if (reset.length) Object.assign(data, { identityConfidence: null, readiness: null, readinessReasons: [] });
        await db.contact.update({ where: { id: existing.id }, data });
        for (const [field, value] of reset) await setContactField(existing.id, field, { value, status: "unknown", source, observedAt: field === "title" ? (p.titleObservedAt ?? ctx.now) : undefined, recheckUsed: false });
        if (reset.length) changes.push(`${existing.fullName}: ${reset.map(([f]) => f).join(", ")}`);
        contactOutcome = "updated";
      } else {
        contactOutcome = "unchanged";
      }
    }

    // ── Sender journey (only the selected sender's journey is touched) ──
    if (ctx.campaignId && ctx.senderId) {
      const { journey, created } = await ensureJourney(contactId, ctx.campaignId, ctx.senderId);
      const activities = await importActivities(journey.id, r.activity, created, ctx.now);
      if (activities.length) await recordActivities(journey.id, activities, "csv", ctx.filename);
      else if (created) await db.journeyEvent.create({ data: { journeyId: journey.id, type: "imported", toStage: "not_contacted", source: "csv", detail: ctx.filename, occurredAt: ctx.now } });
      journeyOutcome = created ? "created" : activities.length ? "updated" : "unchanged";
    }
  }

  // ── Queue for an automatic pipeline run if anything is new or changed ──
  if (accountOutcome !== "unchanged" || contactOutcome === "created" || contactOutcome === "updated") {
    await db.account.updateMany({
      where: { id: account.id, pipelineStatus: { not: "running" } },
      data: { pipelineStatus: "queued", queuedFromStage: 2, lastImportBatchId: ctx.batchId },
    });
  }
  return { accountId: account.id, account: accountOutcome, contact: contactOutcome, journey: journeyOutcome, changes };
}

/**
 * Turn the row's LinkedIn activity columns into journey activities. For an existing
 * journey only what is new is added (re-uploading the same file changes nothing).
 */
async function importActivities(journeyId: string, a: ActivityRow | null, created: boolean, now: Date): Promise<Activity[]> {
  if (!a) return [];
  const journey = created ? null : await db.journey.findUnique({ where: { id: journeyId }, include: { events: { select: { type: true, detail: true } } } });
  const has = (type: string) => journey?.events.some((e) => e.type === type) ?? false;
  const at = (d: Date | true | null) => (d instanceof Date ? d : now);
  const out: Activity[] = [];
  if (a.connectionSent && !has("connection_sent")) out.push({ type: "connection_sent", at: at(a.connectionSent) });
  if (a.connectionAccepted && !has("connection_accepted")) {
    if (!a.connectionSent && !has("connection_sent")) out.push({ type: "connection_sent", at: at(a.connectionAccepted) });
    out.push({ type: "connection_accepted", at: at(a.connectionAccepted) });
  }
  const already = journey?.followUpCount ?? 0;
  for (let i = already; i < (a.followUps ?? 0); i++) out.push({ type: "follow_up_sent", at: a.lastFollowUp ?? now });
  if (a.lastReply && !journey?.events.some((e) => e.type === "reply" && e.detail?.startsWith(a.lastReply!.slice(0, 200)))) {
    out.push({ type: "reply", at: a.lastReplyDate ?? now, text: a.lastReply, meaning: classifyReplyRules(a.lastReply).stage });
  }
  if (a.stage && a.stage !== journey?.stage) out.push({ type: "stage_set", at: now, stage: a.stage, detail: "Stage column in the CSV" });
  return out;
}

export interface ChunkResult {
  accepted: number;
  rejected: number;
  errors: { row: number; error: string }[];
  accountIds: string[];
}

/**
 * Validate and upsert a chunk of rows. `rowOffset` is the index of the first row
 * in the file (data rows start at spreadsheet row 2, after the header).
 */
export async function importChunk(batchId: string, rows: Record<string, unknown>[], rowOffset = 0, mapping?: Record<string, FieldKey>): Promise<ChunkResult> {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  const headerMap = mapping ?? (batch.mapping as Record<string, FieldKey> | null) ?? analyzeHeaders([...new Set(rows.flatMap((r) => Object.keys(r)))]).mapping;
  const ctx: RowContext = { source: batch.source === "csv" ? "CSV Import" : batch.source, batchId, filename: batch.filename, campaignId: batch.campaignId, senderId: batch.senderId, now: new Date() };
  const stats = { ...emptyStats(), ...(batch.stats as unknown as Partial<BatchStats>) };
  const errors: { row: number; error: string }[] = [];
  const accountIds = new Set<string>();
  const seenAccount = new Map<string, AccountOutcome>(); // count each account once per chunk
  const changesByAccount = new Map<string, string[]>();
  let accepted = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNo = rowOffset + i + 2;
    const v = validateRow(rows[i] ?? {}, headerMap);
    if (!v.ok) {
      errors.push({ row: rowNo, error: v.error });
      continue;
    }
    try {
      const res = await upsertRow(v.row, ctx);
      accepted++;
      accountIds.add(res.accountId);
      // Keep the strongest outcome per account: created > updated > unchanged.
      const rank = { unchanged: 0, updated: 1, created: 2 } as const;
      const prev = seenAccount.get(res.accountId);
      if (!prev || rank[res.account] > rank[prev]) seenAccount.set(res.accountId, res.account);
      if (res.contact === "created") stats.contactsCreated++;
      else if (res.contact === "updated") stats.contactsUpdated++;
      else if (res.contact === "unchanged") stats.contactsUnchanged++;
      else if (res.contact === "erased") {
        stats.skippedErased++;
        errors.push({ row: rowNo, error: "Contact skipped: this person asked to be erased (GDPR)" });
      }
      if (res.journey === "created") stats.journeysCreated++;
      else if (res.journey === "updated") stats.journeysUpdated++;
      if (res.changes.length) changesByAccount.set(res.accountId, [...(changesByAccount.get(res.accountId) ?? []), ...res.changes]);
    } catch (e) {
      errors.push({ row: rowNo, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
  }
  for (const [id, outcome] of seenAccount) {
    if (outcome === "created") stats.accountsCreated++;
    else if (outcome === "updated") stats.accountsUpdated++;
    else stats.accountsUnchanged++;
    const changed = changesByAccount.get(id);
    await db.pipelineEvent.create({
      data: { accountId: id, stage: 1, step: "data_input.receive_record", outcome: "pass", runId: batchId, reason: `${outcome === "created" ? "New from" : outcome === "updated" ? "Updated by" : "Seen in"} ${batch.filename}${changed?.length ? ` — changed: ${changed.slice(0, 5).join("; ")}` : ""}` },
    });
  }
  await db.account.updateMany({ where: { id: { in: [...accountIds] }, pipelineStage: 0 }, data: { pipelineStage: 1 } });

  const storedErrors = [...((batch.errors as { row: number; error: string }[]) ?? []), ...errors].slice(0, MAX_STORED_ERRORS);
  await db.importBatch.update({
    where: { id: batchId },
    data: { accepted: { increment: accepted }, rejected: { increment: errors.filter((e) => !e.error.startsWith("Contact skipped")).length }, errors: storedErrors, stats: stats as unknown as Prisma.InputJsonValue },
  });
  return { accepted, rejected: errors.length, errors, accountIds: [...accountIds] };
}

/** Close the upload; queued accounts are processed automatically afterwards. */
export async function finishBatch(batchId: string) {
  const toProcess = await db.account.count({ where: { lastImportBatchId: batchId, pipelineStatus: "queued" } });
  return db.importBatch.update({ where: { id: batchId }, data: { status: toProcess ? "processing" : "done", toProcess, finishedAt: toProcess ? null : new Date() } });
}

export interface IngestResult {
  batchId: string;
  accepted: number;
  rejected: number;
  accountIds: string[];
  errors: { row: number; error: string }[];
}

/** One-shot import (API, forms, seed, tests): start → one chunk → finish. */
export async function ingestRows(rows: unknown[], opts: { source: string; filename?: string; campaignId?: string | null; senderId?: string | null }): Promise<IngestResult> {
  const objects = rows.map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}));
  const headers = [...new Set(objects.flatMap((r) => Object.keys(r)))];
  const analysis = analyzeHeaders(headers);
  const batch = await startBatch({
    filename: opts.filename ?? `${opts.source}-${new Date().toISOString().slice(0, 16)}`, source: opts.source, rows: rows.length, ignoredColumns: analysis.ignored,
    campaignId: opts.campaignId, senderId: opts.senderId, mapping: analysis.mapping,
  });
  const res = await importChunk(batch.id, objects, 0, analysis.mapping);
  await finishBatch(batch.id);
  return { batchId: batch.id, accepted: res.accepted, rejected: res.rejected, accountIds: res.accountIds, errors: res.errors };
}
