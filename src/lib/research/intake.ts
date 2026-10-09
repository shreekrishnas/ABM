// The bridge from import to research. Everything a CSV brought in is mapped field by
// field; what is missing is researched first (gap fill), what is already known is not
// paid for again, and LinkedIn conversations from the import decide how deep to go.

import type { Account, JourneyStage } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { normalizeCountry, normalizeDomain } from "@/lib/pipeline/normalize";
import { setAccountField } from "@/lib/pipeline/fields";
import { BudgetExceeded, charge, logEvent, openReview, type RunContext } from "@/lib/pipeline/context";
import { STAGE_INFO } from "@/lib/journey/stages";
import type { ResearchPage } from "@/lib/adapters/types";

// ── What the import told us ──

/** Journey stages that mean a person has responded on LinkedIn. */
export const ENGAGED_STAGES: JourneyStage[] = ["replied_neutral", "details_requested", "details_shared", "interested", "call_scheduled", "demo_scheduled", "opportunity"];

export interface ImportContext {
  technologies: string[];
  keywords: string[];
  notes: string | null;
  conversations: { name: string; title: string | null; stage: string; lastReply: string | null; sender: string }[];
}

export async function importContext(account: Account): Promise<ImportContext> {
  const journeys = await db.journey.findMany({
    where: { contact: { accountId: account.id, mergedIntoId: null }, stage: { in: ENGAGED_STAGES } },
    include: { contact: { select: { fullName: true, title: true } }, sender: { select: { name: true } }, events: { where: { type: "reply" }, orderBy: { occurredAt: "desc" }, take: 1 } },
    orderBy: { lastEngagementAt: "desc" },
    take: 6,
  });
  return {
    technologies: account.technologies,
    keywords: account.keywords,
    notes: account.companyNotes,
    conversations: journeys.map((j) => ({
      name: j.contact.fullName, title: j.contact.title, stage: STAGE_INFO[j.stage].label, phrase: STAGE_INFO[j.stage].phrase, sender: j.sender.name,
      lastReply: j.events[0]?.detail?.split(" · ")[0] ?? null,
    })),
  };
}

/**
 * How deep to research. T1 always gets the deep dive; T2 gets the two strongest deep
 * questions; T3 the core only — unless someone at the company has already replied on
 * LinkedIn, which earns the full deep dive whatever the tier.
 */
export function researchDepth(tier: Account["tier"], ctx: ImportContext, intent?: { level: string; score: number; families: string[] }): { depth: "core" | "deep"; deepKeys: number; cap: number; reason: string } {
  const engaged = ctx.conversations[0];
  // Converging intent signals earn the deep dive even before tier does.
  if (!engaged && intent?.level === "hot") return { depth: "deep", deepKeys: 99, cap: CONFIG.research.maxQuestions, reason: `deep — hot intent ${intent.score} (${intent.families.join(", ")})` };
  if (engaged) return { depth: "deep", deepKeys: 99, cap: CONFIG.research.maxQuestions, reason: `deep — engaged on LinkedIn: ${engaged.name} (${engaged.stage})` };
  if (tier === "T1") return { depth: "deep", deepKeys: 99, cap: CONFIG.research.maxQuestions, reason: "deep — T1 company" };
  if (tier === "T2") return { depth: "deep", deepKeys: 2, cap: 7, reason: "core + 2 deep questions — T2 company" };
  return { depth: "core", deepKeys: 0, cap: 4, reason: "core only — T3 company" };
}

// ── Intake map (what we hold for each field, and where it came from) ──

export interface IntakeField {
  key: string;
  label: string;
  value: string | null;
  source: string | null;
  status: string;
  gap: boolean;
}

export async function intakeMap(account: Account): Promise<IntakeField[]> {
  const states = await db.fieldState.findMany({ where: { accountId: account.id } });
  const st = (f: string) => states.find((s) => s.field === f);
  const row = (key: string, label: string, value: string | null, critical = false): IntakeField => {
    const s = st(key);
    return { key, label, value, source: s?.source ?? (value ? account.source : null), status: value ? (s?.status ?? "unknown") : "missing", gap: critical && !value };
  };
  return [
    row("domain", "Company website", account.domain, true),
    row("linkedin", "Company LinkedIn", account.linkedinUrl),
    row("industry", "Industry", account.industry, true),
    row("employees", "Employee size", account.employees?.toLocaleString() ?? null, true),
    row("country", "Country", account.country, true),
    row("city", "City", account.city),
    row("technologies", "Technologies used", account.technologies.join("; ") || null),
    row("keywords", "Keywords", account.keywords.join("; ") || null),
    row("notes", "Company notes", account.companyNotes),
  ];
}

// ── Gap fill: research what the import left out, before fit and identity run ──

const DIRECTORY = /(linkedin|facebook|twitter|x\.com|instagram|youtube|wikipedia|crunchbase|zaubacorp|tofler|indiamart|justdial|glassdoor|naukri|ambitionbox|bloomberg|zoominfo|apollo\.io|rocketreach|dnb\.com|economictimes|moneycontrol|google\.)/i;

/** The official site among search results: a non-directory host whose page names the company. */
export function pickOfficialSite(pages: ResearchPage[], company: string): { domain: string; url: string } | null {
  const tokens = company.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llp|co|company|the)\b/g, " ").split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const scored = pages
    .map((p) => {
      const domain = normalizeDomain(p.url);
      if (!domain || DIRECTORY.test(domain)) return null;
      const text = `${p.title} ${p.text}`.toLowerCase();
      const hostHits = tokens.filter((t) => domain.includes(t)).length;
      const textHits = tokens.filter((t) => text.includes(t)).length;
      if (!textHits) return null;
      return { domain, url: p.url, score: hostHits * 2 + textHits + (/official|home|about/i.test(p.title) ? 1 : 0) };
    })
    .filter(Boolean) as { domain: string; url: string; score: number }[];
  scored.sort((a, b) => b.score - a.score);
  // The host must carry the brand (first word of the name) or two name words — a news site
  // that merely shares a word ("autonews" for "Trident Auto") is not their site.
  const ownsName = (d: string) => d.includes(tokens[0] ?? "\u0000") || tokens.filter((t) => d.includes(t)).length >= 2;
  const own = scored.find((x) => ownsName(x.domain));
  return own ? { domain: own.domain, url: own.url } : null;
}

type Searcher = (account: Account, ctx: RunContext, key: string, query: string, why: string) => Promise<ResearchPage[]>;

/**
 * Stage 2b. For each critical field the import did not provide, run one targeted
 * search and fill it with a source. Imported values are never overwritten.
 */
export async function fillGaps(account: Account, ctx: RunContext, search: Searcher): Promise<Account> {
  const S = 2;
  const filled: string[] = [];
  const name = account.name;
  const place = [account.city, account.country].filter(Boolean).join(" ");

  try {
    // 1. Website — without it identity and email cannot be verified.
    if (!account.domain) {
      const slug = account.linkedinUrl?.match(/company\/([^/]+)/)?.[1]?.replace(/-/g, " ");
      const pages = await search(account, ctx, "website", `"${name}" official website ${place} ${slug && slug.toLowerCase() !== name.toLowerCase() ? slug : ""}`.trim(), "Find the company's own website so people and emails can be verified");
      const site = pickOfficialSite(pages, name);
      if (!site) {
        await logEvent(ctx, { accountId: account.id, stage: S, step: "intake.website", outcome: "block", reason: "No official website found — add Company Website to the next upload" });
      } else {
        const owner = await db.account.findUnique({ where: { domain: site.domain } });
        if (owner && owner.id !== account.id) {
          await openReview({ type: "other", stage: S, accountId: account.id, reason: `Research found ${site.domain} for ${name}, but it belongs to ${owner.name} — same company? Merge or correct by hand.` });
          await logEvent(ctx, { accountId: account.id, stage: S, step: "intake.website", outcome: "block", reason: `${site.domain} already belongs to ${owner.name} — sent to review` });
        } else {
          account = await db.account.update({ where: { id: account.id }, data: { domain: site.domain } });
          await setAccountField(account.id, "domain", { value: site.domain, status: "probable", source: `research: ${site.url}` });
          filled.push(`website ${site.domain}`);
          await logEvent(ctx, { accountId: account.id, stage: S, step: "intake.website", outcome: "pass", reason: `Found ${site.domain} (${site.url})` });
        }
      }
    }

    // 2. Industry, size, country — the fit score needs them.
    const missing = [!account.industry && "industry", account.employees == null && "employees", !account.country && "country"].filter(Boolean) as string[];
    if (missing.length) {
      const pages = await search(account, ctx, "firmographics", `"${name}" ${account.domain ?? ""} company profile employees industry headquarters`.trim(), `Fill ${missing.join(", ")} for the fit score`);
      if (pages.length) {
        await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, "Extract firmographics", S);
        const f = await ctx.adapters.llm.extractFirmographics(pages, name);
        const page = f ? pages[f.page] : undefined;
        if (f && page) {
          const data: Partial<Pick<Account, "industry" | "employees" | "country">> = {};
          if (!account.industry && f.industry) data.industry = f.industry.toLowerCase().slice(0, 80);
          if (account.employees == null && f.employees && f.employees > 0 && f.employees < 5_000_000) data.employees = Math.round(f.employees);
          const country = f.country ? normalizeCountry(f.country) : null;
          if (!account.country && country) data.country = country;
          if (Object.keys(data).length) {
            account = await db.account.update({ where: { id: account.id }, data });
            for (const [k, v] of Object.entries(data)) await setAccountField(account.id, k, { value: String(v), status: "probable", source: `research: ${page.url}` });
            filled.push(...Object.entries(data).map(([k, v]) => `${k} ${v}`));
            await logEvent(ctx, { accountId: account.id, stage: S, step: "intake.firmographics", outcome: "pass", reason: `Filled ${Object.entries(data).map(([k, v]) => `${k} = ${v}`).join(", ")} from ${page.url}` });
          }
        }
      }
      if (!filled.some((x) => missing.some((m) => x.startsWith(m)))) await logEvent(ctx, { accountId: account.id, stage: S, step: "intake.firmographics", outcome: "info", reason: `Could not find ${missing.join(", ")} — fit is scored on known fields only` });
    }
  } catch (e) {
    // A search outage or the budget cap must not stop the company's run: fit is scored on known fields.
    await logEvent(ctx, { accountId: account.id, stage: S, step: "intake.gap_fill", outcome: e instanceof BudgetExceeded ? "info" : "error", reason: e instanceof BudgetExceeded ? "Gap fill skipped — budget reached" : `Gap fill failed: ${e instanceof Error ? e.message.slice(0, 160) : e}` });
  }
  if (filled.length) await logEvent(ctx, { accountId: account.id, stage: S, step: "intake.summary", outcome: "pass", reason: `Research filled: ${filled.join("; ")}` });
  return account;
}
