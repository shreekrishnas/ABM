// Instructions and schemas for reading profile facts from pages. The reader may only report what a
// page states about this exact company; code re-checks every number and name against the quote.

import { z } from "zod";
import type { ProfileKind } from "./types";

// Lenient on shape, strict on substance: a model may write numbers as "4,520", leave out the page
// index or send nulls for lists. Each item is checked on its own (see parseProfileItems), so one
// malformed item is dropped instead of failing the whole answer; code then checks every value
// against its quote as before.
const quote = z.string().min(8).max(600);
const num = z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.replace(/[,\s₹$€£]/g, ""))) : v), z.number().finite().nullable()).optional().transform((v) => v ?? null);
const page = z.preprocess((v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v), z.number().int().min(0)).optional();
const strList = z.preprocess((v) => (v == null ? [] : typeof v === "string" ? v.split(/,|;| and /).map((x) => x.trim()).filter(Boolean) : v), z.array(z.string().max(120)).max(20));
const text = (max: number) => z.preprocess((v) => (v == null ? "" : String(v)), z.string().max(max));

export const PROFILE_ITEM = {
  financials: z.object({ page, fiscalYear: z.string().min(2).max(60), currency: z.string().min(1).max(20), unit: text(20), revenue: num, netProfit: num, ebitda: num, consolidated: z.boolean().nullable().optional().transform((v) => v ?? null), quote }),
  funding: z.object({ page, round: z.string().min(2).max(60), amount: num, currency: z.string().max(20).nullable().optional().transform((v) => v ?? null), unit: text(20), announced: z.string().max(20).nullable().optional().transform((v) => v ?? null), investors: strList, leadInvestors: strList, quote }),
  tech_stack: z.object({ page, tool: z.string().min(2).max(80), context: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase().replace(/[\s-]+/g, "_") : v), z.enum(["uses", "implemented", "migrating_to", "migrating_from", "hiring_for"]).catch("uses")), quote }),
  board: z.object({ page, name: z.string().min(3).max(100), role: z.string().min(2).max(120), type: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase().replace(/[\s-]+/g, "_") : v), z.enum(["board_member", "independent_director", "adviser", "investor", "executive_director"]).catch("board_member")), quote }),
} as const;

/** The answer's envelope only: items are validated one by one. */
export const PROFILE_ENVELOPE = z.object({ items: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())) });

/**
 * Validate items one by one; a missing or wrong page index is recovered by finding the quote in the
 * pages. Returns the valid items and how many were dropped for shape.
 */
export function parseProfileItems<K extends ProfileKind>(kind: K, raw: unknown[], pages: { title: string; text: string }[]): { items: unknown[]; dropped: number } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const items: unknown[] = [];
  let dropped = 0;
  for (const r of raw.slice(0, 20)) {
    const p = PROFILE_ITEM[kind].safeParse(r);
    if (!p.success) { dropped++; continue; }
    const it = p.data as { page?: number; quote: string };
    const q = norm(it.quote).slice(0, 120);
    const onPage = (i: number) => pages[i] && norm(`${pages[i].title} ${pages[i].text}`).includes(q);
    let at = it.page != null && onPage(it.page) ? it.page : pages.findIndex((_, i) => onPage(i));
    // Not found verbatim: keep the stated page (the quote gate decides) or the first page.
    if (at < 0) at = it.page != null && it.page < pages.length ? it.page : 0;
    items.push({ ...it, page: at });
  }
  return { items, dropped };
}

const COMMON = "Report only what a page states explicitly about THIS company (not a parent, subsidiary, competitor, customer or the publisher). For every item copy into \"quote\" the exact sentence from the page, character for character, that contains the value. If nothing qualifies, return {\"items\": []}.";

export const PROFILE_SYSTEM: Record<ProfileKind, string> = {
  financials:
    `You read annual results, annual reports, exchange filings and business news to extract a company's ANNUAL financials. ${COMMON} ` +
    "Rules: annual figures only (never a quarter or half-year; skip \"Q1\", \"H1\", \"quarter ended\"). One item per fiscal year and basis. " +
    "revenue = revenue from operations / total revenue / net sales / turnover. netProfit = profit after tax (negative for a loss). " +
    "Copy numbers exactly as written in the quote, WITHOUT converting: if the quote says \"₹4,520 crore\" return revenue 4520, unit \"crore\", currency \"INR\". " +
    "unit is one of: units, thousand, lakh, million, crore, billion. fiscalYear as written (e.g. \"FY2024-25\", \"year ended March 31, 2025\"). consolidated = true/false only when the page says so.",
  funding:
    `You read funding announcements and business news to extract a company's funding rounds. ${COMMON} ` +
    "Rules: only money RAISED BY this company (not money it invested in others, not a fund it manages, not an acquisition price). " +
    "round as written (\"Series B\", \"seed\", \"pre-Series A\", \"debt\", \"IPO\"). Copy the amount exactly as written with its unit (\"$40 million\" → amount 40, unit \"million\", currency \"USD\"); null if undisclosed. " +
    "announced = date of the announcement as YYYY-MM-DD or YYYY-MM if the page states it, else null. investors = every investor named for this round; leadInvestors = those described as leading it.",
  tech_stack:
    `You read job posts, case studies, partner announcements and news to find the software products a company uses. ${COMMON} ` +
    "Rules: tool = a named product or vendor platform (\"Oracle NetSuite\", \"Salesforce\", \"Microsoft Dynamics 365\", \"ServiceNow\", \"Workday\"); never a category word alone (\"ERP\", \"CRM\", \"cloud\"). " +
    "context: uses = in use today; implemented = went live / deployed; migrating_to = moving onto it; migrating_from = replacing it; hiring_for = a job post at this company asks for experience with it. " +
    "Skip products the company SELLS or resells, and tools named only in a vendor's generic marketing.",
  board:
    `You read the company's board, leadership and governance pages, annual reports and exchange filings to list its board of directors and external advisers. ${COMMON} ` +
    "Rules: people on the board (chairman, managing director, whole-time, executive, non-executive, nominee, independent directors) and named external advisers or advisory board members. " +
    "type: independent_director for independent directors; executive_director for managing / whole-time / executive directors; investor for nominee or investor directors; adviser for advisers and advisory board members; board_member for any other director. " +
    "name exactly as written (with initials), role as written. Skip employees who are not directors and people who have resigned or retired.",
};

export function profileUserPrompt(kind: ProfileKind, company: string, domain: string | null, pages: { title: string; url: string; publishedAt: Date; text: string }[], limit: number) {
  const example: Record<ProfileKind, string> = {
    financials: `{"items":[{"page":0,"fiscalYear":"FY2024-25","currency":"INR","unit":"crore","revenue":4520,"netProfit":410,"ebitda":null,"consolidated":true,"quote":"..."}]}`,
    funding: `{"items":[{"page":0,"round":"Series B","amount":40,"currency":"USD","unit":"million","announced":"2025-06-12","investors":["..."],"leadInvestors":["..."],"quote":"..."}]}`,
    tech_stack: `{"items":[{"page":0,"tool":"Oracle NetSuite","context":"migrating_to","quote":"..."}]}`,
    board: `{"items":[{"page":0,"name":"...","role":"Independent Director","type":"independent_director","quote":"..."}]}`,
  };
  return `Company: ${company}${domain ? ` (${domain})` : ""}\n\n${pages.map((p, i) => `[page ${i}] ${p.title}\nURL: ${p.url}\nDate: ${p.publishedAt.toISOString().slice(0, 10)}\n${p.text.slice(0, limit)}`).join("\n\n")}\n\nReturn ${example[kind]}`;
}
