// Instructions and schemas for reading profile facts from pages. The reader may only report what a
// page states about this exact company; code re-checks every number and name against the quote.

import { z } from "zod";
import type { ProfileKind } from "./types";

const quote = z.string().min(8).max(500);

export const PROFILE_SCHEMA = {
  financials: z.object({
    items: z.array(z.object({
      page: z.number().int(), fiscalYear: z.string().min(2).max(60), currency: z.string().min(1).max(20), unit: z.string().max(20),
      revenue: z.number().nullable(), netProfit: z.number().nullable(), ebitda: z.number().nullable().optional().transform((v) => v ?? null),
      consolidated: z.boolean().nullable().optional().transform((v) => v ?? null), quote,
    })).max(8),
  }),
  funding: z.object({
    items: z.array(z.object({
      page: z.number().int(), round: z.string().min(2).max(40), amount: z.number().nullable(), currency: z.string().max(20).nullable(), unit: z.string().max(20),
      announced: z.string().max(10).nullable(), investors: z.array(z.string().max(80)).max(15), leadInvestors: z.array(z.string().max(80)).max(5), quote,
    })).max(8),
  }),
  tech_stack: z.object({
    items: z.array(z.object({
      page: z.number().int(), tool: z.string().min(2).max(60), context: z.enum(["uses", "implemented", "migrating_to", "migrating_from", "hiring_for"]), quote,
    })).max(20),
  }),
  board: z.object({
    items: z.array(z.object({
      page: z.number().int(), name: z.string().min(3).max(80), role: z.string().min(3).max(80),
      type: z.enum(["board_member", "independent_director", "adviser", "investor", "executive_director"]), quote,
    })).max(20),
  }),
} as const;

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
