// Stage 1 — Data Input. Accepts rows from CSV uploads, the API, forms or manual
// entry, validated against the predefined template (src/lib/import/fields.ts).
//
// Built for regular re-uploads (weekly or more): rows are UPSERTED, not appended.
//   • Accounts match on normalized domain; contacts on email, then name, within the account.
//   • Non-blank values from the newest file win; blank cells never erase data.
//   • Only fields that actually changed lose their verified status and get re-checked.
//   • Anything new or changed is queued for an automatic pipeline run; unchanged
//     accounts are left alone (no repeated spend).
//   • People erased under GDPR are never re-imported; unsubscribed people stay suppressed.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { analyzeHeaders, validateRow, type CleanRow, type FieldKey } from "@/lib/import/fields";
import { inferFunction, inferSeniority, splitName, standardizeTitle } from "./normalize";
import { setAccountField, setContactField } from "./fields";
import { sha256 } from "./crypto";

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
}

export const emptyStats = (): BatchStats => ({ accountsCreated: 0, accountsUpdated: 0, accountsUnchanged: 0, contactsCreated: 0, contactsUpdated: 0, contactsUnchanged: 0, skippedErased: 0 });

const MAX_STORED_ERRORS = 500;

export async function startBatch(opts: { filename: string; source: string; rows: number; ignoredColumns?: string[] }) {
  return db.importBatch.create({
    data: { filename: opts.filename, source: opts.source, status: "uploading", rows: opts.rows, accepted: 0, rejected: 0, errors: [], stats: emptyStats() as unknown as Prisma.InputJsonValue, ignoredColumns: opts.ignoredColumns ?? [] },
  });
}

type AccountOutcome = "created" | "updated" | "unchanged";
type ContactOutcome = "created" | "updated" | "unchanged" | "none" | "erased";

async function upsertRow(r: CleanRow, source: string, batchId: string): Promise<{ accountId: string; account: AccountOutcome; contact: ContactOutcome; changes: string[] }> {
  const changes: string[] = [];

  // ── Account ──
  let account = await db.account.findUnique({ where: { domain: r.domain } });
  if (account?.mergedIntoId) account = await db.account.findUnique({ where: { id: account.mergedIntoId } });
  let accountOutcome: AccountOutcome = "unchanged";
  if (!account) {
    account = await db.account.create({ data: { name: r.company, domain: r.domain, industry: r.industry, employees: r.employees, country: r.country, source } });
    accountOutcome = "created";
    for (const [field, value] of [["domain", r.domain], ["industry", r.industry], ["employees", r.employees?.toString() ?? null], ["country", r.country]] as const) {
      if (value) await setAccountField(account.id, field, { value, status: "unknown", source });
    }
  } else {
    const data: Prisma.AccountUpdateInput = {};
    if (r.industry && r.industry !== account.industry) data.industry = r.industry;
    if (r.employees != null && r.employees !== account.employees) data.employees = r.employees;
    if (r.country && r.country !== account.country) data.country = r.country;
    const changed = Object.keys(data);
    if (changed.length) {
      account = await db.account.update({ where: { id: account.id }, data });
      accountOutcome = "updated";
      for (const f of changed as ("industry" | "employees" | "country")[]) {
        await setAccountField(account.id, f, { value: account[f]?.toString() ?? null, status: "unknown", source });
        changes.push(f);
      }
    }
  }

  // ── Contact ──
  let contactOutcome: ContactOutcome = "none";
  if (r.contactName || r.email) {
    if (r.email) {
      const erased = await db.suppression.findUnique({ where: { value: `sha256:${sha256(r.email)}` } });
      if (erased) return { accountId: account.id, account: accountOutcome, contact: "erased", changes };
    }
    const fullName = (r.contactName ?? r.email!.split("@")[0].replace(/[._]+/g, " ")).replace(/\s+/g, " ").trim();
    const existing =
      (r.email ? await db.contact.findFirst({ where: { accountId: account.id, mergedIntoId: null, email: { equals: r.email, mode: "insensitive" } } }) : null) ??
      (await db.contact.findFirst({ where: { accountId: account.id, mergedIntoId: null, fullName: { equals: fullName, mode: "insensitive" } } }));
    const suppressed = r.email ? Boolean(await db.suppression.findUnique({ where: { value: r.email } })) : false;

    if (!existing) {
      const { first, last } = splitName(fullName);
      const title = standardizeTitle(r.title);
      const c = await db.contact.create({
        data: {
          accountId: account.id, fullName, firstName: first, lastName: last, email: r.email, phone: r.phone, title: r.title,
          titleNormalized: title, function: inferFunction(title), seniority: inferSeniority(title), linkedinUrl: r.linkedinUrl,
          country: account.country, source, state: suppressed ? "suppressed" : "new",
        },
      });
      for (const [field, value] of [["email", r.email], ["title", r.title], ["phone", r.phone], ["linkedin", r.linkedinUrl], ["company", account.domain]] as const) {
        if (value) await setContactField(c.id, field, { value, status: "unknown", source, observedAt: field === "title" ? r.titleObservedAt : null });
      }
      contactOutcome = "created";
    } else {
      const data: Prisma.ContactUpdateInput = {};
      const reset: [string, string | null][] = [];
      if (r.email && r.email !== existing.email?.toLowerCase()) {
        data.email = r.email;
        reset.push(["email", r.email]);
      }
      if (r.title && r.title !== existing.title) {
        const title = standardizeTitle(r.title);
        Object.assign(data, { title: r.title, titleNormalized: title, function: inferFunction(title), seniority: inferSeniority(title), buyingRole: "unknown" });
        reset.push(["title", r.title]);
      }
      if (r.phone && r.phone !== existing.phone) {
        data.phone = r.phone;
        reset.push(["phone", r.phone]);
      }
      if (r.linkedinUrl && r.linkedinUrl !== existing.linkedinUrl) {
        data.linkedinUrl = r.linkedinUrl;
        reset.push(["linkedin", r.linkedinUrl]);
      }
      if (suppressed && existing.state !== "suppressed") data.state = "suppressed";
      if (Object.keys(data).length) {
        // A changed person must be verified again before any outreach.
        if (reset.length) Object.assign(data, { identityConfidence: null, readiness: null, readinessReasons: [] });
        await db.contact.update({ where: { id: existing.id }, data });
        for (const [field, value] of reset) await setContactField(existing.id, field, { value, status: "unknown", source, observedAt: field === "title" ? (r.titleObservedAt ?? new Date()) : undefined, recheckUsed: false });
        if (reset.length) changes.push(`${existing.fullName}: ${reset.map(([f]) => f).join(", ")}`);
        contactOutcome = "updated";
      } else {
        contactOutcome = "unchanged";
      }
    }
  }

  // ── Queue for an automatic pipeline run if anything is new or changed ──
  if (accountOutcome !== "unchanged" || contactOutcome === "created" || contactOutcome === "updated") {
    await db.account.updateMany({
      where: { id: account.id, pipelineStatus: { not: "running" } },
      data: { pipelineStatus: "queued", queuedFromStage: 2, lastImportBatchId: batchId },
    });
  }
  return { accountId: account.id, account: accountOutcome, contact: contactOutcome, changes };
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
  const headerMap = mapping ?? analyzeHeaders([...new Set(rows.flatMap((r) => Object.keys(r)))]).mapping;
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
      const res = await upsertRow(v.row, batch.filename, batchId);
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
export async function ingestRows(rows: unknown[], opts: { source: string; filename?: string }): Promise<IngestResult> {
  const objects = rows.map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}));
  const headers = [...new Set(objects.flatMap((r) => Object.keys(r)))];
  const analysis = analyzeHeaders(headers);
  const batch = await startBatch({ filename: opts.filename ?? `${opts.source}-${new Date().toISOString().slice(0, 16)}`, source: opts.source, rows: rows.length, ignoredColumns: analysis.ignored });
  const res = await importChunk(batch.id, objects, 0, analysis.mapping);
  await finishBatch(batch.id);
  return { batchId: batch.id, accepted: res.accepted, rejected: res.rejected, accountIds: res.accountIds, errors: res.errors };
}
