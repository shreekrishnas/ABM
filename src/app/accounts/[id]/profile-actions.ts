"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { logAction, refresh } from "@/lib/action-utils";
import { newContext } from "@/lib/pipeline/context";
import { unscoped } from "@/lib/scope";
import { FX_TO_USD, normFiscalYear, parseUnit, toAbsolute, toUsd, type Unit } from "@/lib/profile/money";
import type { ActionState } from "@/app/actions";

/** Research the company profile again now (all parts this tier gets), charged to the company's budget. */
export async function refreshProfileAction(accountId: string): Promise<ActionState> {
  // The scoped read is the access check: a user only refreshes companies they can see.
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, message: "Company not found" };
  await logAction("profile.refresh", { accountId });
  const { researchCompanyProfile } = await import("@/lib/profile/run");
  const s = await unscoped(() => researchCompanyProfile(account, newContext(), { force: true }));
  await rescore(accountId);
  refresh(`/accounts/${accountId}`);
  const found = [s.financials && `${s.financials} financial figure${s.financials === 1 ? "" : "s"}`, s.funding && `${s.funding} funding round${s.funding === 1 ? "" : "s"}`, s.technologies && `${s.technologies} technolog${s.technologies === 1 ? "y" : "ies"}`, s.board && `${s.board} board member${s.board === 1 ? "" : "s"}`].filter(Boolean);
  const skipped = s.skipped.filter((x) => x.reason !== "Research not connected");
  if (s.skipped.some((x) => x.reason === "Research not connected")) return { ok: false, message: "Web research isn't connected (search and AI keys); website technology detection still ran" };
  return { ok: true, message: `${found.length ? `Found ${found.join(", ")}` : "Nothing new found"}${s.dropped ? `; ${s.dropped} value${s.dropped === 1 ? "" : "s"} dropped for not matching their source` : ""}${skipped.length ? `; ${skipped.map((x) => `${x.kind}: ${x.reason}`).join("; ")}` : ""}` };
}

/** Financial capacity is part of fit: re-score after the profile changes. */
async function rescore(accountId: string) {
  const { rescoreFit } = await import("@/lib/pipeline/fit-research");
  const a = await db.account.findUnique({ where: { id: accountId } });
  if (a) await unscoped(() => rescoreFit(a));
}

const num = z.union([z.literal(""), z.coerce.number().finite()]).transform((v) => (v === "" ? null : v));

const recordSchema = z.object({
  accountId: z.string().min(1),
  fiscalYear: z.string().trim().min(2, "Enter the fiscal year, e.g. FY2024-25"),
  periodEnd: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || null),
  currency: z.string().refine((c) => Boolean(FX_TO_USD[c]), "Choose a currency"),
  unit: z.enum(["units", "thousand", "lakh", "million", "crore", "billion"]),
  revenue: num, netProfit: num, ebitda: num, totalAssets: num, totalDebt: num,
  kind: z.enum(["filing", "provider"]),
  document: z.string().trim().min(3, "Say which document or provider the figures come from").max(300),
  reference: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * A legally obtained financial record: figures from an audited annual report, a government
 * filing (e.g. bought from the company registry) or a licensed data provider. These outrank web
 * research for the same fiscal year and are marked verified, with who added them and from what.
 */
export async function addFinancialRecordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(["accountId", "fiscalYear", "periodEnd", "currency", "unit", "revenue", "netProfit", "ebitda", "totalAssets", "totalDebt", "kind", "document", "reference", "note"].map((k) => [k, String(fd.get(k) ?? "").replace(/,/g, k === "document" || k === "note" || k === "reference" ? "," : "")]));
  const p = recordSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data;
  const account = await db.account.findUnique({ where: { id: d.accountId } });
  if (!account) return { ok: false, message: "Company not found" };
  const fy = normFiscalYear(d.fiscalYear);
  if (!fy) return { ok: false, message: "Fiscal year not recognised: write it like FY2024-25, FY25 or 2025" };
  if (Number(fy.slice(2)) > new Date().getUTCFullYear() + 1) return { ok: false, message: `${fy} is in the future` };
  if (d.revenue == null && d.netProfit == null && d.totalAssets == null) return { ok: false, message: "Enter at least revenue, net profit or total assets" };
  if (d.revenue != null && d.revenue <= 0) return { ok: false, message: "Revenue must be above zero" };
  const unit = parseUnit(d.unit) as Unit;
  const abs = (v: number | null) => toAbsolute(v, unit);
  const revenue = abs(d.revenue);
  const netProfit = abs(d.netProfit);
  if (revenue != null && netProfit != null && Math.abs(netProfit) > revenue * 1.5) return { ok: false, message: "Net profit is larger than revenue: check the figures and the unit" };
  const reference = d.reference && /^https?:\/\//.test(d.reference) ? d.reference : null;
  await logAction("financials.add", { accountId: d.accountId });
  const { getMe } = await import("@/lib/me");
  const me = await getMe();
  const data = {
    periodEnd: d.periodEnd ? new Date(`${d.periodEnd}T00:00:00Z`) : null, currency: d.currency,
    revenue, netProfit, ebitda: abs(d.ebitda), totalAssets: abs(d.totalAssets), totalDebt: abs(d.totalDebt),
    revenueUsd: toUsd(revenue, d.currency), netProfitUsd: toUsd(netProfit, d.currency),
    provider: d.kind === "provider" ? d.document : null, sourceUrls: reference ? [reference] : [], quotes: [],
    publisher: d.document, status: "verified" as const, reports: 1, addedBy: me?.email ?? "a team member",
    note: [d.kind === "filing" ? `From: ${d.document}` : `Provider: ${d.document}`, d.reference && !reference ? `Reference: ${d.reference}` : null, d.note].filter(Boolean).join(" · "),
  };
  await db.companyFinancial.upsert({
    where: { accountId_fiscalYear_source: { accountId: d.accountId, fiscalYear: fy, source: d.kind } },
    create: { accountId: d.accountId, fiscalYear: fy, source: d.kind, ...data },
    update: data,
  });
  const { refreshProfileSummary } = await import("@/lib/profile/run");
  await refreshProfileSummary(d.accountId);
  await rescore(d.accountId);
  refresh(`/accounts/${d.accountId}`);
  return { ok: true, message: `${fy} saved as a verified ${d.kind === "filing" ? "filed" : "provider"} record; it now outranks web figures for that year` };
}

export async function removeFinancialRecordAction(id: string): Promise<ActionState> {
  const row = await db.companyFinancial.findUnique({ where: { id }, include: { account: { select: { id: true } } } });
  // Scoped: the account include only resolves for companies this user can see.
  if (!row || !(await db.account.findUnique({ where: { id: row.accountId }, select: { id: true } }))) return { ok: false, message: "Record not found" };
  if (row.source === "web") return { ok: false, message: "Web figures can't be deleted; flag the source fact instead" };
  await logAction("financials.remove", { accountId: row.accountId });
  await db.companyFinancial.delete({ where: { id } });
  const { refreshProfileSummary } = await import("@/lib/profile/run");
  await refreshProfileSummary(row.accountId);
  await rescore(row.accountId);
  refresh(`/accounts/${row.accountId}`);
  return { ok: true, message: `${row.fiscalYear} record removed` };
}
