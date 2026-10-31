// Company profile research: revenue and profit by fiscal year, funding rounds, the technology
// stack and the board. Runs after the main research pass (stage 6) and from the company page.
//
// Every stored value has to survive four checks, in order:
//   1. the quote is really on the page (quote gate) and the page is about this company (entity gate);
//   2. the value is really in the quote (numbers for money, the person's name for the board, the
//      product name for technologies) — the guard against invented figures;
//   3. sanity rules (annual figures only, no future dates, revenue per employee within range);
//   4. status: official source (company site, exchange, regulator) or two independent sites that
//      agree = verified; one site = probable. Filings and licensed providers outrank the web.

import type { Account, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { BudgetExceeded, charge, logEvent, type RunContext } from "@/lib/pipeline/context";
import { entityGate, quoteGate } from "@/lib/pipeline/gates";
import { gapSearch } from "@/lib/pipeline/stages/research";
import { inferFunction, inferSeniority, splitName } from "@/lib/pipeline/normalize";
import type { ResearchPage } from "@/lib/adapters/types";
import { GENERIC_TECH_WORDS, matchTech, type TechCategory } from "./catalog";
import { financialHealth } from "./health";
import { amountInQuote, normFiscalYear, parseCurrency, parseUnit, toAbsolute, toUsd } from "./money";
import { PROFILE_LABEL, type BoardItem, type FinancialItem, type FundingItem, type ProfileKind, type TechItem } from "./types";
import { detectWebsiteTech } from "./website";
import { builtWithLookup } from "./builtwith";

const S = 6;
const DAY = 86_400_000;

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Company site, exchange, regulator or registry: one such source is enough to verify. */
export function isOfficialSource(url: string, domain: string | null): boolean {
  const h = hostOf(url);
  if (!h) return false;
  const own = domain?.toLowerCase().replace(/^www\./, "");
  if (own && (h === own || h.endsWith(`.${own}`))) return true;
  return CONFIG.profile.officialHosts.some((o) => h === o || h.endsWith(`.${o}`));
}

function queryFor(kind: ProfileKind, name: string, now: Date): string {
  const c = `"${name}"`;
  const y = now.getUTCFullYear();
  switch (kind) {
    case "financials": return `${c} annual results revenue from operations net profit FY${y} OR FY${y - 1} OR ${y - 1}-${String(y).slice(2)}`;
    case "funding": return `${c} raises OR raised funding round Series investors`;
    case "tech_stack": return `${c} (SAP OR Oracle OR Salesforce OR "Microsoft Dynamics" OR ServiceNow OR Workday OR HubSpot OR Zoho) (implementation OR "go-live" OR selects OR "case study" OR hiring)`;
    case "board": return `${c} board of directors independent director chairman`;
  }
}

export interface ProfileSummary {
  ran: ProfileKind[];
  skipped: { kind: string; reason: string }[];
  financials: number;
  funding: number;
  technologies: number;
  board: number;
  dropped: number;
}

/** Research the parts of the profile this company's tier gets (or `kinds`), skipping parts that are still fresh. */
export async function researchCompanyProfile(account: Account, ctx: RunContext, opts: { force?: boolean; kinds?: ProfileKind[] } = {}): Promise<ProfileSummary> {
  const sum: ProfileSummary = { ran: [], skipped: [], financials: 0, funding: 0, technologies: 0, board: 0, dropped: 0 };
  const kinds = (opts.kinds ?? (CONFIG.profile.byTier[account.tier ?? "T3"] as ProfileKind[])) as ProfileKind[];
  const strict = ctx.adapters.research.live ? "live" : "mock";

  // Free: technologies proven by the company's own website markup (live only; never a guess).
  await websiteTech(account, ctx, opts.force ?? false, sum);
  // Paid, optional: a tech-lookup provider for T1/T2 when its key is set.
  if (account.tier === "T1" || account.tier === "T2") await providerTech(account, ctx, opts.force ?? false, sum);

  if (ctx.adapters.research.connected === false) {
    sum.skipped.push({ kind: "web research", reason: "Research not connected" });
    await logEvent(ctx, { accountId: account.id, stage: S, step: "company_profile.skipped", outcome: "info", reason: "Company profile: research not connected" });
    return sum;
  }

  for (const kind of kinds) {
    if (!opts.force) {
      const recent = await db.researchQuery.findFirst({
        where: { accountId: account.id, key: `profile:${kind}`, cached: false, error: null, createdAt: { gte: new Date(ctx.now.getTime() - (CONFIG.profile.refreshDays[kind] ?? 90) * DAY) } },
        select: { createdAt: true },
      });
      if (recent) {
        sum.skipped.push({ kind, reason: `Researched ${recent.createdAt.toISOString().slice(0, 10)}; refreshes after ${CONFIG.profile.refreshDays[kind]} days` });
        continue;
      }
    }
    try {
      const pages = await gapSearch(account, ctx, `profile:${kind}`, queryFor(kind, account.name, ctx.now), `Company profile: ${PROFILE_LABEL[kind].toLowerCase()}`);
      sum.ran.push(kind);
      if (!pages.length) {
        await logEvent(ctx, { accountId: account.id, stage: S, step: `company_profile.${kind}`, outcome: "info", reason: `${PROFILE_LABEL[kind]}: no sources found` });
        continue;
      }
      await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, `Read ${PROFILE_LABEL[kind].toLowerCase()}`, S);
      const items = await ctx.adapters.llm.extractProfile(kind, pages, { name: account.name, domain: account.domain });
      const r =
        kind === "financials" ? await saveFinancials(account, pages, items as FinancialItem[], strict, ctx)
        : kind === "funding" ? await saveFunding(account, pages, items as FundingItem[], strict, ctx)
        : kind === "tech_stack" ? await saveTech(account, pages, items as TechItem[], strict)
        : await saveBoard(account, pages, items as BoardItem[], strict);
      sum.dropped += r.dropped.length;
      if (kind === "financials") sum.financials += r.kept;
      if (kind === "funding") sum.funding += r.kept;
      if (kind === "tech_stack") sum.technologies += r.kept;
      if (kind === "board") sum.board += r.kept;
      await logEvent(ctx, {
        accountId: account.id, stage: S, step: `company_profile.${kind}`, outcome: r.kept ? "pass" : "info",
        reason: `${PROFILE_LABEL[kind]}: ${r.kept} kept from ${pages.length} source(s)${r.dropped.length ? `, ${r.dropped.length} dropped` : ""}`,
        data: { dropped: r.dropped.slice(0, 8) } as Prisma.InputJsonValue,
      });
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      sum.skipped.push({ kind, reason: "Budget reached" });
      await logEvent(ctx, { accountId: account.id, stage: S, step: `company_profile.${kind}`, outcome: "info", reason: `${PROFILE_LABEL[kind]}: skipped, budget reached` });
      break;
    }
  }
  await refreshProfileSummary(account.id, ctx.now);
  return sum;
}

type Saved = { kept: number; dropped: string[] };

function pageGate(item: { page: number; quote: string }, pages: ResearchPage[], account: Account, strict: "live" | "mock"): { page: ResearchPage } | { reason: string } {
  const page = pages[item.page];
  if (!page) return { reason: "points to a page that wasn't returned" };
  const q = quoteGate(item.quote, page, strict);
  if (!q.pass) return { reason: q.reason };
  if (strict === "live") {
    const e = entityGate(account.name, account.domain, page);
    if (!e.pass) return { reason: e.reason };
  }
  return { page };
}

// ── Financials ──

async function saveFinancials(account: Account, pages: ResearchPage[], items: FinancialItem[], strict: "live" | "mock", ctx: RunContext): Promise<Saved> {
  const dropped: string[] = [];
  let kept = 0;
  for (const it of items) {
    const g = pageGate(it, pages, account, strict);
    if ("reason" in g) { dropped.push(`${it.fiscalYear}: ${g.reason}`); continue; }
    if (/\b(q[1-4]|h[12]|quarter|half[- ]year|nine months|9m)\b/i.test(`${it.fiscalYear} ${it.quote}`) && !/\b(full[- ]year|annual|fy\s?\d{2})\b/i.test(it.fiscalYear)) { dropped.push(`${it.fiscalYear}: not an annual figure`); continue; }
    const fy = normFiscalYear(it.fiscalYear);
    const currency = parseCurrency(it.currency) ?? parseCurrency(it.quote);
    const unit = parseUnit(it.unit);
    if (!fy) { dropped.push(`"${it.fiscalYear}": fiscal year unclear`); continue; }
    if (Number(fy.slice(2)) > ctx.now.getUTCFullYear() + 1) { dropped.push(`${fy}: in the future`); continue; }
    if (!currency) { dropped.push(`${fy}: currency unclear`); continue; }
    // The numbers must be written in the quote, as given (before unit conversion).
    const revenueOk = it.revenue != null && amountInQuote(it.revenue, it.quote);
    const profitOk = it.netProfit != null && amountInQuote(Math.abs(it.netProfit), it.quote);
    if (!revenueOk && !profitOk) { dropped.push(`${fy}: figures not in the quoted sentence`); continue; }
    let revenue = revenueOk ? toAbsolute(it.revenue, unit) : null;
    let netProfit = profitOk ? toAbsolute(it.netProfit, unit) : null;
    const ebitda = it.ebitda != null && amountInQuote(Math.abs(it.ebitda), it.quote) ? toAbsolute(it.ebitda, unit) : null;
    if (revenue != null && revenue <= 0) revenue = null;
    // Profit larger than revenue is a misread (a different line item).
    if (revenue != null && netProfit != null && Math.abs(netProfit) > revenue * 1.5) netProfit = null;
    const revenueUsd = toUsd(revenue, currency);
    const notes: string[] = [];
    if (it.consolidated === false) notes.push("standalone");
    if (it.consolidated === true) notes.push("consolidated");
    let suspicious = false;
    if (revenueUsd != null && account.employees && account.employees > 0) {
      const perEmp = revenueUsd / account.employees;
      const { min, max } = CONFIG.profile.revenuePerEmployeeUsd;
      if (perEmp < min || perEmp > max) {
        suspicious = true;
        notes.push(`check the unit: ${Math.round(perEmp).toLocaleString()} USD revenue per employee is outside ${min.toLocaleString()}–${max.toLocaleString()}`);
      }
    }
    const url = g.page.url;
    const official = isOfficialSource(url, account.domain);
    const existing = await db.companyFinancial.findUnique({ where: { accountId_fiscalYear_source: { accountId: account.id, fiscalYear: fy, source: "web" } } });
    if (existing) {
      if (existing.sourceUrls.includes(url)) continue;
      const agree = existing.revenue != null && revenue != null ? Math.abs(existing.revenue - revenue) / Math.max(existing.revenue, revenue) <= CONFIG.profile.agreeWithin : existing.netProfit != null && netProfit != null && Math.abs(existing.netProfit - netProfit) <= Math.abs(existing.netProfit) * CONFIG.profile.agreeWithin;
      const independent = !existing.sourceUrls.some((u) => hostOf(u) === hostOf(url));
      if (!agree) {
        // Two sources disagree on the same year: keep the official one, otherwise keep the first and say so.
        if (official && !existing.sourceUrls.some((u) => isOfficialSource(u, account.domain))) {
          await db.companyFinancial.update({ where: { id: existing.id }, data: { revenue, netProfit, ebitda, revenueUsd, netProfitUsd: toUsd(netProfit, currency), currency, sourceUrls: [url, ...existing.sourceUrls], quotes: [it.quote.slice(0, 400), ...existing.quotes].slice(0, 4), publisher: hostOf(url), status: "verified", note: `Official figure; another source said ${existing.revenue ?? existing.netProfit}` } });
          kept++;
        } else {
          await db.companyFinancial.update({ where: { id: existing.id }, data: { note: [existing.note, `${hostOf(url)} reports a different figure — check`].filter(Boolean).join("; ") } });
          dropped.push(`${fy}: ${hostOf(url)} disagrees with the figure already held`);
        }
        continue;
      }
      const reports = existing.reports + (independent ? 1 : 0);
      await db.companyFinancial.update({
        where: { id: existing.id },
        data: {
          revenue: existing.revenue ?? revenue, netProfit: existing.netProfit ?? netProfit, ebitda: existing.ebitda ?? ebitda,
          revenueUsd: existing.revenueUsd ?? revenueUsd, netProfitUsd: existing.netProfitUsd ?? toUsd(netProfit, currency),
          sourceUrls: [...existing.sourceUrls, url], quotes: [...existing.quotes, it.quote.slice(0, 400)].slice(0, 4), reports,
          status: (official || reports >= 2) && !suspicious ? "verified" : existing.status,
        },
      });
      kept++;
      continue;
    }
    await db.companyFinancial.create({
      data: {
        accountId: account.id, fiscalYear: fy, currency, revenue, netProfit, ebitda, revenueUsd, netProfitUsd: toUsd(netProfit, currency),
        source: "web", sourceUrls: [url], quotes: [it.quote.slice(0, 400)], publisher: hostOf(url),
        status: official && !suspicious ? "verified" : "probable", reports: 1, note: notes.join("; ") || null,
      },
    });
    kept++;
  }
  return { kept, dropped };
}

// ── Funding ──

const ROUND_MAP: [RegExp, string][] = [
  [/pre[- ]?seed/i, "pre_seed"], [/\bseed\b|angel/i, "seed"], [/pre[- ]?series[- ]?a/i, "seed"],
  [/series[- ]?([a-h])\b/i, "series_$1"], [/\bgrowth\b|late[- ]stage/i, "growth"], [/private equity|\bpe\b|buyout/i, "private_equity"],
  [/\bdebt\b|venture debt|loan|ncd|bond/i, "debt"], [/pre[- ]?ipo/i, "private_equity"], [/\bipo\b|listing|public offer/i, "ipo"], [/grant/i, "grant"],
];

export function normRound(raw: string): string {
  for (const [re, key] of ROUND_MAP) {
    const m = raw.match(re);
    if (m) return key.includes("$1") ? key.replace("$1", m[1].toLowerCase()) : key;
  }
  return "undisclosed";
}

function parseAnnounced(raw: string | null, fallback: Date, now: Date): Date | null {
  if (!raw) return fallback;
  const m = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return fallback;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1)));
  return Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + DAY ? null : d;
}

async function saveFunding(account: Account, pages: ResearchPage[], items: FundingItem[], strict: "live" | "mock", ctx: RunContext): Promise<Saved> {
  const dropped: string[] = [];
  let kept = 0;
  for (const it of items) {
    const g = pageGate(it, pages, account, strict);
    if ("reason" in g) { dropped.push(`${it.round}: ${g.reason}`); continue; }
    const stage = normRound(it.round);
    const announcedAt = parseAnnounced(it.announced, g.page.publishedAt, ctx.now);
    if (!announcedAt) { dropped.push(`${it.round}: date in the future`); continue; }
    const amountOk = it.amount != null && amountInQuote(it.amount, it.quote);
    const currency = it.amount != null ? parseCurrency(it.currency) ?? parseCurrency(it.quote) : null;
    const amount = amountOk ? toAbsolute(it.amount, parseUnit(it.unit)) : null;
    // Investors must be named in the quote or on the page (no invented names).
    const hay = `${it.quote} ${g.page.text}`.toLowerCase();
    const investors = [...new Set(it.investors.map((x) => x.trim()).filter((x) => x.length > 1 && hay.includes(x.toLowerCase())))];
    const leads = [...new Set(it.leadInvestors.map((x) => x.trim()).filter((x) => investors.includes(x) || hay.includes(x.toLowerCase())))];
    const url = g.page.url;
    // Same round = same stage within 45 days (the announcement and the follow-up coverage).
    const near = await db.fundingRound.findFirst({ where: { accountId: account.id, stage, announcedAt: { gte: new Date(announcedAt.getTime() - 45 * DAY), lte: new Date(announcedAt.getTime() + 45 * DAY) } } });
    if (near) {
      if (near.sourceUrls.includes(url)) continue;
      const independent = !near.sourceUrls.some((u) => hostOf(u) === hostOf(url));
      const amountAgrees = near.amount == null || amount == null || Math.abs(near.amount - amount) / Math.max(near.amount, amount) <= 0.05;
      const reports = near.reports + (independent && amountAgrees ? 1 : 0);
      await db.fundingRound.update({
        where: { id: near.id },
        data: {
          amount: near.amount ?? amount, currency: near.currency ?? currency, amountUsd: near.amountUsd ?? toUsd(amount, currency),
          investors: [...new Set([...near.investors, ...investors])], leadInvestors: [...new Set([...near.leadInvestors, ...leads])],
          sourceUrls: [...near.sourceUrls, url], quotes: [...near.quotes, it.quote.slice(0, 400)].slice(0, 4), reports,
          status: reports >= 2 || isOfficialSource(url, account.domain) ? "verified" : near.status,
        },
      });
      kept++;
      continue;
    }
    await db.fundingRound.create({
      data: {
        accountId: account.id, stage, amount, currency, amountUsd: toUsd(amount, currency), announcedAt, investors, leadInvestors: leads,
        sourceUrls: [url], quotes: [it.quote.slice(0, 400)], status: isOfficialSource(url, account.domain) ? "verified" : "probable", reports: 1,
      },
    });
    kept++;
  }
  return { kept, dropped };
}

// ── Technologies ──

const SOURCE_OF: Record<ResearchPage["sourceType"], string> = { careers: "job_post", official: "case_study", press: "press", news: "press", provider: "provider", review_site: "press", mock: "press" };

export async function upsertTech(accountId: string, t: { name: string; vendor?: string | null; category: TechCategory | string; source: string; url?: string | null; detail?: string | null }, now = new Date()) {
  const cur = await db.techUse.findUnique({ where: { accountId_name: { accountId, name: t.name } } });
  if (cur) {
    await db.techUse.update({
      where: { id: cur.id },
      data: {
        sources: [...new Set([...cur.sources, t.source])], evidenceUrls: t.url && !cur.evidenceUrls.includes(t.url) ? [...cur.evidenceUrls, t.url].slice(-6) : cur.evidenceUrls,
        detail: cur.detail ?? t.detail ?? null, lastSeen: now,
      },
    });
    return false;
  }
  await db.techUse.create({ data: { accountId, name: t.name, vendor: t.vendor ?? null, category: t.category, sources: [t.source], evidenceUrls: t.url ? [t.url] : [], detail: t.detail?.slice(0, 300) ?? null, firstSeen: now, lastSeen: now } });
  return true;
}

async function saveTech(account: Account, pages: ResearchPage[], items: TechItem[], strict: "live" | "mock"): Promise<Saved> {
  const dropped: string[] = [];
  let kept = 0;
  for (const it of items) {
    const tool = it.tool.trim();
    if (GENERIC_TECH_WORDS.has(tool.toLowerCase())) { dropped.push(`"${tool}": a category, not a product`); continue; }
    const g = pageGate(it, pages, account, strict);
    if ("reason" in g) { dropped.push(`${tool}: ${g.reason}`); continue; }
    const entry = matchTech(tool);
    // The product must be named in the quote (by its name or one of its aliases).
    const named = entry ? matchTech(it.quote)?.name === entry.name || it.quote.toLowerCase().includes(tool.toLowerCase()) : it.quote.toLowerCase().includes(tool.toLowerCase());
    if (!named) { dropped.push(`${tool}: not named in the quoted sentence`); continue; }
    // A product the company is moving away from is still in use today; record it with its context.
    const source = it.context === "hiring_for" ? "job_post" : SOURCE_OF[g.page.sourceType] ?? "press";
    const contextWord = { uses: "uses", implemented: "implemented", migrating_to: "moving to", migrating_from: "moving off", hiring_for: "hiring for" }[it.context];
    await upsertTech(account.id, { name: entry?.name ?? tool, vendor: entry?.vendor ?? null, category: entry?.category ?? "other", source, url: g.page.url, detail: `${contextWord}: “${it.quote.slice(0, 220)}”` });
    kept++;
  }
  return { kept, dropped };
}

async function websiteTech(account: Account, ctx: RunContext, force: boolean, sum: ProfileSummary) {
  if (!account.domain || !ctx.adapters.research.live) return;
  if (!force) {
    const recent = await db.techUse.findFirst({ where: { accountId: account.id, sources: { has: "website" }, lastSeen: { gte: new Date(ctx.now.getTime() - CONFIG.profile.refreshDays.website * DAY) } } });
    if (recent) return;
  }
  const { detections, pagesRead } = await detectWebsiteTech(account.domain);
  let added = 0;
  for (const d of detections) if (await upsertTech(account.id, { name: d.name, vendor: d.vendor, category: d.category, source: "website", url: d.url, detail: `found in the page markup: ${d.detail}` }, ctx.now)) added++;
  sum.technologies += detections.length;
  await logEvent(ctx, { accountId: account.id, stage: S, step: "company_profile.website_tech", outcome: detections.length ? "pass" : "info", reason: pagesRead.length ? `Website: ${detections.length} technolog${detections.length === 1 ? "y" : "ies"} detected on ${pagesRead.length} page(s)${added ? `, ${added} new` : ""}` : "Website could not be read (blocked by robots.txt or unavailable)" });
}

async function providerTech(account: Account, ctx: RunContext, force: boolean, sum: ProfileSummary) {
  if (!account.domain || !process.env.BUILTWITH_API_KEY?.trim() || !ctx.adapters.research.live) return;
  if (!force) {
    const recent = await db.techUse.findFirst({ where: { accountId: account.id, sources: { has: "provider" }, lastSeen: { gte: new Date(ctx.now.getTime() - CONFIG.profile.refreshDays.tech_stack * DAY) } } });
    if (recent) return;
  }
  try {
    await charge(account.id, account.tier, "lookup", CONFIG.costsUsd.techLookup, "Tech lookup (BuiltWith)", S);
  } catch (e) {
    if (e instanceof BudgetExceeded) return;
    throw e;
  }
  const found = await builtWithLookup(account.domain);
  for (const t of found) await upsertTech(account.id, { name: t.name, vendor: t.vendor, category: t.category, source: "provider", url: `https://builtwith.com/${account.domain}`, detail: t.detail }, ctx.now);
  sum.technologies += found.length;
  await logEvent(ctx, { accountId: account.id, stage: S, step: "company_profile.provider_tech", outcome: found.length ? "pass" : "info", reason: `BuiltWith: ${found.length} technolog${found.length === 1 ? "y" : "ies"}` });
}

// ── Board and advisers ──

const STAKEHOLDER: Record<BoardItem["type"], "board_member" | "independent_director" | "adviser" | "investor" | "executive"> = {
  board_member: "board_member", independent_director: "independent_director", adviser: "adviser", investor: "investor", executive_director: "executive",
};

const WHY: Record<BoardItem["type"], string> = {
  independent_director: "Independent director: sits on the audit or risk committee and is asked to sign off on large programmes and controls",
  board_member: "Board member: approves strategy and large spend",
  investor: "Investor or nominee director: pushes portfolio companies on efficiency and governance, and often recommends vendors",
  adviser: "External adviser: shapes the leadership team's priorities and vendor shortlists",
  executive_director: "Executive director: on the board and running the business; a final approver",
};

async function saveBoard(account: Account, pages: ResearchPage[], items: BoardItem[], strict: "live" | "mock"): Promise<Saved> {
  const dropped: string[] = [];
  let kept = 0;
  const seen = new Set<string>();
  for (const it of items) {
    const name = it.name.replace(/\s+/g, " ").trim();
    const g = pageGate(it, pages, account, strict);
    if ("reason" in g) { dropped.push(`${name}: ${g.reason}`); continue; }
    // The person's name (each part of it) must be in the quote.
    const parts = name.replace(/^(dr|mr|mrs|ms|prof|shri|smt)\.?\s+/i, "").split(" ").filter((p) => p.length > 1);
    if (!parts.every((p) => it.quote.toLowerCase().includes(p.toLowerCase().replace(/\.$/, "")))) { dropped.push(`${name}: not named in the quoted sentence`); continue; }
    if (/\b(resigned|retired|ceased|stepped down|former)\b/i.test(it.quote)) { dropped.push(`${name}: no longer on the board`); continue; }
    const key = parts.join(" ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const official = isOfficialSource(g.page.url, account.domain);
    const reason = `${WHY[it.type]}. Source: ${hostOf(g.page.url)} — “${it.quote.slice(0, 160)}”`;
    const existing = await db.contact.findFirst({ where: { accountId: account.id, mergedIntoId: null, fullName: { equals: name, mode: "insensitive" } } });
    if (existing) {
      // An employee who is also a director: keep their buying role, add the board context.
      await db.contact.update({ where: { id: existing.id }, data: { stakeholderType: existing.stakeholderType === "executive" && it.type !== "executive_director" ? STAKEHOLDER[it.type] : existing.stakeholderType, influenceReason: existing.influenceReason ?? reason } });
      kept++;
      continue;
    }
    const { first, last } = splitName(name.replace(/^(dr|mr|mrs|ms|prof|shri|smt)\.?\s+/i, ""));
    await db.contact.create({
      data: {
        accountId: account.id, fullName: name, firstName: first, lastName: last, title: it.role, titleNormalized: it.role,
        function: it.type === "executive_director" ? inferFunction(it.role) : "executive", seniority: it.type === "executive_director" ? inferSeniority(it.role) : "board",
        // Directors and advisers influence the decision; they are not emailed by sequences.
        buyingRole: it.type === "executive_director" ? "decision_maker" : "influencer",
        stakeholderType: STAKEHOLDER[it.type], influenceReason: reason, discoveredBy: "board_research",
        identityConfidence: official ? 0.9 : 0.6, source: official ? "company_site" : "web_research", country: account.country,
      },
    });
    kept++;
  }
  return { kept, dropped };
}

// ── Summary on the account ──

/** Recompute the health reading, revenue and technology list on the account from the profile tables. */
export async function refreshProfileSummary(accountId: string, now = new Date()) {
  const [fins, techs, account] = await Promise.all([
    db.companyFinancial.findMany({ where: { accountId } }),
    db.techUse.findMany({ where: { accountId }, select: { name: true } }),
    db.account.findUniqueOrThrow({ where: { id: accountId }, select: { technologies: true } }),
  ]);
  const health = financialHealth(fins.map((f) => ({ fiscalYear: f.fiscalYear, currency: f.currency, revenue: f.revenue, netProfit: f.netProfit, source: f.source, status: f.status })));
  const latest = fins.filter((f) => f.revenueUsd != null).sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear) || (a.source === "filing" ? -1 : 1))[0];
  const names = techs.map((t) => t.name).filter((n) => !account.technologies.some((x) => x.toLowerCase() === n.toLowerCase()));
  await db.account.update({
    where: { id: accountId },
    data: {
      financialHealth: health.label, financialNote: health.note, profileUpdatedAt: now,
      ...(latest?.revenueUsd != null ? { revenueUsd: BigInt(Math.round(latest.revenueUsd)) } : {}),
      // Fit scoring reads `technologies`: researched products join the imported ones.
      ...(names.length ? { technologies: [...account.technologies, ...names] } : {}),
    },
  });
}


