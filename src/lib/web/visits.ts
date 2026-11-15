// Website visits: every page view on the seller's site, matched to a company and,
// when possible, a person. Known companies get an engagement signal (pricing pages
// count most), which feeds intent, priority, research and the email angle.
// Unknown companies identified by a reverse-IP tool are kept for Discover.

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { companyNameKey, normalizeDomain } from "@/lib/pipeline/normalize";
import { recordSignal } from "@/lib/pipeline/stages/engagement";
import { newContext, type RunContext } from "@/lib/pipeline/context";

const DAY = 86_400_000;

export interface VisitInput {
  url: string;
  title?: string | null;
  referrer?: string | null;
  visitorId?: string | null;
  /** Signed contact token from a tracked link (?abm=…). */
  token?: string | null;
  /** From a reverse-IP tool. */
  companyDomain?: string | null;
  companyName?: string | null;
  durationSec?: number | null;
  source: "tracking_script" | "reverse_ip" | "email_link" | "apollo";
  occurredAt?: Date;
  /** The client whose website was visited. Found from the page's address when not given. */
  sellerId?: string | null;
}

const siteHost = (url: string | null | undefined) => {
  try {
    return url ? new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/** The client whose website this is (the website in its Account Brain), or null when no client or more than one matches. */
export async function clientForSite(url: string | null | undefined): Promise<string | null> {
  const host = siteHost(url);
  if (!host) return null;
  const { baseDb } = await import("@/lib/db-base");
  const { ensureSellerPacks, sellerFor } = await import("@/lib/seller");
  await ensureSellerPacks();
  const clients = await baseDb.client.findMany({ where: { status: { not: "archived" } }, select: { id: true } });
  const hits = clients.filter((c) => {
    const site = siteHost(sellerFor(c.id).website);
    return Boolean(site && (host === site || host.endsWith(`.${site}`)));
  });
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * The company a visit is from, within the client whose website was visited. With no known client,
 * only a website or name that exactly one client holds counts (never a guess between clients).
 */
async function companyFor(sellerId: string | null, where: { domain?: string; nameKey?: string }): Promise<string | null> {
  const rows = await db.account.findMany({ where: { ...where, ...(where.nameKey ? { mergedIntoId: null } : {}), ...(sellerId ? { sellerId } : {}) }, select: { id: true, sellerId: true, mergedIntoId: true }, orderBy: { createdAt: "asc" }, take: 5 });
  if (!rows.length) return null;
  if (!sellerId && new Set(rows.map((r) => r.sellerId)).size > 1) return null;
  // A merged duplicate counts for the company it was merged into.
  const live = rows.find((r) => !r.mergedIntoId) ?? rows[0];
  return live.mergedIntoId ?? live.id;
}

// ── Tracked links: ?abm=<contactId>.<sig> identifies the person who clicked. ──

function secret() {
  return process.env.TRACK_SECRET || process.env.ABM_API_KEY || "abm-dev-track-secret";
}

export function contactToken(contactId: string) {
  return `${contactId}.${createHmac("sha256", secret()).update(contactId).digest("base64url").slice(0, 16)}`;
}

export function contactFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const want = contactToken(id).split(".")[1];
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Adds the person's token to a link so their visits are recognised. */
export function trackedLink(url: string, contactId: string) {
  try {
    const u = new URL(url);
    u.searchParams.set("abm", contactToken(contactId));
    return u.toString();
  } catch {
    return url;
  }
}

// ── What a page is about ──

export interface Topic {
  key: string;
  label: string;
}

export function topicOf(url: string, title?: string | null): Topic {
  const p = seller();
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {}
  const text = `${path} ${title ?? ""}`.toLowerCase().replace(/[-_/]+/g, " ");
  if (/\b(pricing|price|plans?|quote|cost)\b/.test(text)) return { key: "pricing", label: "Pricing" };
  if (/\b(demo|contact|talk to|book)\b/.test(text)) return { key: "demo", label: "Demo / contact" };
  if (/\b(case stud(y|ies)|customers?|success stor(y|ies))\b/.test(text)) return { key: "case_study", label: "Case study" };
  for (const u of p.useCases) {
    const words = [u.key.replace(/_/g, " "), u.name.toLowerCase()];
    if (words.some((w) => w && text.includes(w))) return { key: u.key, label: u.name };
  }
  for (const t of p.triggers) if (t.keywords.some((k) => text.includes(k.toLowerCase()))) return { key: t.key, label: t.label };
  return { key: "general", label: "Website" };
}

/** Pages that show buying interest rather than browsing. */
const STRONG = new Set(["pricing", "demo"]);

// ── Recording ──

/** A visitor Apollo listed without a visit date to our site: shown, never counted in a date range. */
export const UNKNOWN_DATE_TITLE = "Visited the website (seen by Apollo; visit date unknown)";

export async function recordVisit(input: VisitInput, ctx: RunContext = newContext()) {
  const occurredAt = input.occurredAt ?? ctx.now;
  let path = input.url;
  try {
    path = new URL(input.url).pathname || "/";
  } catch {}
  const topic = topicOf(input.url, input.title);

  // Who: a tracked link wins, then an earlier identified visit from the same browser, then the company domain.
  let contactId = contactFromToken(input.token);
  if (!contactId && input.visitorId) {
    const prior = await db.webVisit.findFirst({ where: { visitorId: input.visitorId, contactId: { not: null } }, orderBy: { occurredAt: "desc" }, select: { contactId: true } });
    contactId = prior?.contactId ?? null;
  }
  const contact = contactId ? await db.contact.findUnique({ where: { id: contactId }, select: { id: true, accountId: true } }) : null;
  let accountId = contact?.accountId ?? null;
  const domain = normalizeDomain(input.companyDomain);
  // The client whose website was visited: given, or from the page's address.
  const visitedClient = input.sellerId ?? (input.source === "apollo" ? null : await clientForSite(input.url));
  if (!accountId && domain) accountId = await companyFor(visitedClient, { domain });
  if (!accountId && input.companyName) {
    const key = companyNameKey(input.companyName);
    if (key) accountId = await companyFor(visitedClient, { nameKey: key });
  }
  if (!accountId && input.visitorId) {
    const prior = await db.webVisit.findFirst({ where: { visitorId: input.visitorId, accountId: { not: null } }, orderBy: { occurredAt: "desc" }, select: { accountId: true } });
    accountId = prior?.accountId ?? null;
  }

  const visit = await db.webVisit.create({
    data: {
      accountId, contactId: contact?.id ?? null, visitorId: input.visitorId ?? null,
      companyName: input.companyName?.slice(0, 120) ?? null, companyDomain: domain,
      url: input.url.slice(0, 500), path: path.slice(0, 300), title: input.title?.slice(0, 200) ?? null,
      topic: topic.key, source: input.source, referrer: input.referrer?.slice(0, 300) ?? null,
      durationSec: input.durationSec ?? null, occurredAt,
    },
  });

  // Known company: one engagement signal per page per company per day (no point floods from refreshes).
  let signalled = false;
  if (accountId) {
    const dup = await db.webVisit.count({ where: { accountId, path: visit.path, id: { not: visit.id }, occurredAt: { gte: new Date(occurredAt.getTime() - DAY) } } });
    if (!dup) {
      await recordSignal({
        accountId, contactId: contact?.id ?? null, type: topic.key === "pricing" ? "pricing_visit" : "site_visit",
        source: input.source === "reverse_ip" || input.source === "apollo" ? input.source : "tracking", occurredAt,
        detail: `${topic.label}${input.title ? `: ${input.title}` : ` (${visit.path})`}`.slice(0, 300),
      }, ctx);
      signalled = true;
    }
  }
  return { visit, accountId, contactId: contact?.id ?? null, topic, signalled, strong: STRONG.has(topic.key) };
}

// ── Reading ──

export interface VisitSummary {
  total: number;
  last: Date | null;
  topics: { key: string; label: string; count: number }[];
  pages: { title: string; path: string; at: Date; who: string | null }[];
  /** Plain line for briefs and the writer: what they looked at, never who or when exactly. */
  interest: string | null;
}

export async function visitSummary(where: { accountId?: string; contactId?: string }, now = new Date(), days = 60): Promise<VisitSummary> {
  const visits = await db.webVisit.findMany({
    where: { ...where, occurredAt: { gte: new Date(now.getTime() - days * DAY) } },
    orderBy: { occurredAt: "desc" }, take: 200,
  });
  const contactIds = [...new Set(visits.map((v) => v.contactId).filter(Boolean))] as string[];
  const names = new Map((await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, fullName: true } })).map((c) => [c.id, c.fullName]));
  const counts = new Map<string, number>();
  for (const v of visits) counts.set(v.topic, (counts.get(v.topic) ?? 0) + 1);
  const label = (k: string) => (k === "general" ? "Website" : k === "pricing" ? "Pricing" : k === "demo" ? "Demo / contact" : k === "case_study" ? "Case study" : seller().useCases.find((u) => u.key === k)?.name ?? seller().triggers.find((t) => t.key === k)?.label ?? k);
  const topics = [...counts].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: label(key), count }));
  const specific = topics.filter((t) => t.key !== "general");
  return {
    total: visits.length,
    last: visits[0]?.occurredAt ?? null,
    topics,
    pages: visits.slice(0, 12).map((v) => ({ title: v.title ?? v.path, path: v.path, at: v.occurredAt, who: v.contactId ? names.get(v.contactId) ?? null : null })),
    interest: specific.length ? `Recent interest on our website: ${specific.slice(0, 3).map((t) => t.label.toLowerCase()).join(", ")}` : null,
  };
}

/** Companies visiting the site that are not in the database yet (from a reverse-IP tool). */
export async function unknownVisitors(now = new Date(), days = 30) {
  const rows = await db.webVisit.findMany({
    where: { accountId: null, companyName: { not: null }, occurredAt: { gte: new Date(now.getTime() - days * DAY) } },
    orderBy: { occurredAt: "desc" }, take: 500,
  });
  const by = new Map<string, { name: string; domain: string | null; visits: number; last: Date; topics: Set<string>; strong: boolean }>();
  for (const v of rows) {
    const k = v.companyDomain ?? companyNameKey(v.companyName!);
    const cur = by.get(k) ?? { name: v.companyName!, domain: v.companyDomain, visits: 0, last: v.occurredAt, topics: new Set<string>(), strong: false };
    cur.visits++;
    if (v.topic !== "general") cur.topics.add(topicOf(v.url, v.title).label);
    if (STRONG.has(v.topic)) cur.strong = true;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => Number(b.strong) - Number(a.strong) || b.visits - a.visits).slice(0, 20).map((x) => ({ ...x, topics: [...x.topics] }));
}

/** At send time: links to the seller's own site (TRACK_ORIGINS) get the person's token. */
export function tagLinks(body: string, contactId: string): string {
  const sites = (process.env.TRACK_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (!sites.length) return body;
  return body.replace(/https?:\/\/[^\s)>\]"']+/g, (url) => (sites.some((s) => url.startsWith(s)) ? trackedLink(url, contactId) : url));
}
