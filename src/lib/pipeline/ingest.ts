// Stage 1 — Data Input. Accepts rows from CSV, API, forms or manual entry.
// Nothing is trusted: every field starts as `unknown` and keeps its source.

import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeCountry, normalizeDomain, splitName } from "./normalize";
import { setAccountField, setContactField } from "./fields";

export const IngestRow = z.object({
  company: z.string().trim().min(1, "company is required"),
  domain: z.string().trim().optional().nullable(),
  industry: z.string().trim().optional().nullable(),
  employees: z.union([z.number(), z.string()]).optional().nullable(),
  country: z.string().trim().optional().nullable(),
  contactName: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  title: z.string().trim().optional().nullable(),
  titleObservedAt: z.string().trim().optional().nullable(),
  linkedinUrl: z.string().trim().optional().nullable(),
});

export type IngestRow = z.infer<typeof IngestRow>;

export interface IngestResult {
  batchId: string;
  accepted: number;
  rejected: number;
  accountIds: string[];
  errors: { row: number; error: string }[];
}

/** Map loose CSV headers ("Company Name", "Work Email") onto IngestRow keys. */
export function mapHeaders(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const aliases: Record<string, string[]> = {
    company: ["company", "company name", "account", "account name", "organization", "organisation"],
    domain: ["domain", "website", "company domain", "url", "company website"],
    industry: ["industry", "sector", "vertical"],
    employees: ["employees", "employee count", "headcount", "company size", "size"],
    country: ["country", "hq country", "company country"],
    contactName: ["name", "full name", "contact", "contact name", "person"],
    email: ["email", "work email", "email address", "contact email"],
    phone: ["phone", "phone number", "mobile", "direct dial"],
    title: ["title", "job title", "position", "role"],
    titleObservedAt: ["title date", "title observed at", "title_observed_at", "last verified"],
    linkedinUrl: ["linkedin", "linkedin url", "linkedin profile"],
  };
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim().toLowerCase().replace(/_/g, " ");
    const target = Object.entries(aliases).find(([, list]) => list.includes(key))?.[0] ?? k;
    if (v !== "" && v !== undefined) out[target] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function parseEmployees(v: IngestRow["employees"]): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const range = v.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
  if (range) return Math.round((Number(range[1].replace(/,/g, "")) + Number(range[2].replace(/,/g, ""))) / 2);
  const n = Number(v.replace(/[,+\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function ingestRows(rows: unknown[], opts: { source: string; filename?: string }): Promise<IngestResult> {
  const errors: { row: number; error: string }[] = [];
  const accountIds = new Set<string>();
  let accepted = 0;

  for (let i = 0; i < rows.length; i++) {
    const parsed = IngestRow.safeParse(mapHeaders((rows[i] ?? {}) as Record<string, unknown>));
    if (!parsed.success) {
      errors.push({ row: i + 1, error: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      continue;
    }
    const r = parsed.data;
    try {
      const domain = normalizeDomain(r.domain);
      const employees = parseEmployees(r.employees);
      const country = normalizeCountry(r.country);

      // Upsert by normalized domain so the same company in two files is one account.
      let account = domain ? await db.account.findUnique({ where: { domain } }) : null;
      if (account?.mergedIntoId) account = await db.account.findUnique({ where: { id: account.mergedIntoId } });
      if (!account && !domain) account = await db.account.findFirst({ where: { name: { equals: r.company, mode: "insensitive" }, domain: null, mergedIntoId: null } });
      if (!account) {
        account = await db.account.create({
          data: { name: r.company, domain, industry: r.industry ?? null, employees, country, source: opts.source },
        });
      } else {
        // Fill gaps only; never overwrite a value we already hold.
        account = await db.account.update({
          where: { id: account.id },
          data: {
            industry: account.industry ?? r.industry ?? null,
            employees: account.employees ?? employees,
            country: account.country ?? country,
          },
        });
      }
      accountIds.add(account.id);
      for (const [field, value] of [["industry", account.industry], ["employees", account.employees?.toString() ?? null], ["country", account.country], ["domain", account.domain]] as const) {
        await setAccountField(account.id, field, { value, status: "unknown", source: opts.filename ?? opts.source });
      }

      if (r.contactName || r.email) {
        const fullName = r.contactName ?? r.email!.split("@")[0].replace(/[._]/g, " ");
        const { first, last } = splitName(fullName);
        const contact = await db.contact.create({
          data: {
            accountId: account.id,
            fullName,
            firstName: first,
            lastName: last,
            email: r.email ?? null,
            phone: r.phone ?? null,
            title: r.title ?? null,
            linkedinUrl: r.linkedinUrl ?? null,
            source: opts.source,
          },
        });
        const observed = r.titleObservedAt ? new Date(r.titleObservedAt) : null;
        for (const [field, value] of [["email", r.email], ["title", r.title], ["phone", r.phone], ["linkedin", r.linkedinUrl], ["company", account.domain]] as const) {
          await setContactField(contact.id, field, {
            value: value ?? null,
            status: "unknown",
            source: opts.filename ?? opts.source,
            observedAt: field === "title" && observed && !Number.isNaN(observed.getTime()) ? observed : null,
          });
        }
      }
      accepted++;
    } catch (e) {
      errors.push({ row: i + 1, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const batch = await db.importBatch.create({
    data: { filename: opts.filename ?? `${opts.source}-${new Date().toISOString()}`, source: opts.source, rows: rows.length, accepted, rejected: errors.length, errors },
  });
  for (const id of accountIds) {
    await db.pipelineEvent.create({ data: { accountId: id, stage: 1, step: "data_input.receive_record", outcome: "pass", reason: `Received from ${opts.filename ?? opts.source}`, runId: batch.id } });
    await db.account.updateMany({ where: { id, pipelineStage: 0 }, data: { pipelineStage: 1 } });
  }
  return { batchId: batch.id, accepted, rejected: errors.length, accountIds: [...accountIds], errors };
}
