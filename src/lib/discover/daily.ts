// The daily prospecting run, once per client per weekday from the morning check. For each client
// with live research on, inside that client's own Account Brain:
//   1. news scan for buying events (new companies)          — existing market scan
//   2. job lists from careers sites (held accounts, suggestions) — free, no AI
//   3. re-check of top held accounts for anything new        — one cached search each
//   4. (optional) companies like a won or engaged account     — existing lookalikes
// then ranks everything into "Recommended today". The Test client runs the same steps on
// stand-in services, so it never searches the web. Nothing is researched or emailed here:
// a person picks from the list.

import type { Account, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base";
import { seller, withSeller } from "@/lib/seller";
import { logEvent, newContext, type RunContext } from "@/lib/pipeline/context";
import { canonicalUrl } from "@/lib/research/precision";
import { buildDailyList, dailySettings, istDate, saveDailyList } from "./recommend";
import { matchesRole, readCareers, roleWords, type Job, type JobIO } from "@/lib/signals/jobs";

const DAY = 86_400_000;
const SAMPLE_CLIENT = "test";

/** Live careers reads: robots.txt honoured, public sites only. */
async function liveIO(): Promise<JobIO> {
  const { readHtml } = await import("@/lib/adapters/live/reader");
  const { fetchJson } = await import("@/lib/adapters/live/http");
  return { html: (u) => readHtml(u), json: (u) => fetchJson("Careers feed", u, { timeoutMs: 12_000, waits: [] }) };
}

/** Stand-in careers sites for the Test client: about a third use Greenhouse and post one relevant role. */
export function sampleIO(roles: string[]): JobIO {
  const h = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    async html(u) {
      const host = new URL(u).hostname.replace(/^www\./, "");
      const slug = host.split(".")[0];
      return { html: h(host) % 3 === 0 ? `<a href="https://boards.greenhouse.io/${slug}">Careers</a>` : `<a href="/about">About</a>`, finalUrl: u };
    },
    async json(u) {
      const slug = u.split("/boards/")[1]?.split("/")[0] ?? "x";
      const role = roles[h(slug) % Math.max(1, roles.length)] ?? "master data";
      const posted = new Date(Date.now() - (h(slug) % 9) * DAY).toISOString();
      return { jobs: [
        { title: `${titleCase(role.length < 6 ? `Head of ${role.toUpperCase()}` : role.startsWith("head") || role.startsWith("vp") || role.startsWith("chief") ? role : `${role} Manager`)}`, absolute_url: `https://boards.greenhouse.io/${slug}/jobs/${h(slug) % 100000}`, location: { name: "Mumbai" }, updated_at: posted },
        { title: "Sales Executive", absolute_url: `https://boards.greenhouse.io/${slug}/jobs/1`, location: { name: "Pune" }, updated_at: posted },
      ] };
    },
  };
}

/** Clients the daily run covers: active ones with live research on, then the Test client on stand-ins. */
export async function dailyClients(): Promise<string[]> {
  const [{ researchOnIds }, { stoppedClientIds }] = await Promise.all([import("@/lib/admin/research-clients"), import("@/lib/admin/client-status")]);
  const [on, stopped, sample] = await Promise.all([researchOnIds(), stoppedClientIds(), baseDb.client.findUnique({ where: { id: SAMPLE_CLIENT }, select: { status: true } })]);
  return [...on.filter((id) => !stopped.includes(id)), ...(sample?.status === "active" ? [SAMPLE_CLIENT] : [])];
}

async function spentSince(sellerId: string, since: Date): Promise<number> {
  const r = await db.ledgerEntry.aggregate({ where: { sellerId, createdAt: { gte: since } }, _sum: { amountMicros: true } });
  return (r._sum.amountMicros ?? 0) / 1e6;
}

/** Job lists for held accounts and suggestions with a website. Matching jobs become facts (accounts) or sources (suggestions). */
async function jobFeeds(sellerId: string, ctx: RunContext, io: JobIO, limit: number, deadline: number) {
  const p = seller();
  const words = roleWords(p);
  const now = ctx.now;
  // Don't re-read a site within a week when it had no feed, within a day when it did.
  const recent = await db.careersFeed.findMany({ where: { sellerId, lastCheckedAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { domain: true, status: true, lastCheckedAt: true } });
  const skip = new Set(recent.filter((r) => r.status !== "found" || now.getTime() - r.lastCheckedAt.getTime() < DAY).map((r) => r.domain));
  const accounts = await db.account.findMany({
    where: { sellerId, mergedIntoId: null, domain: { not: null }, stage: { notIn: ["CUSTOMER", "DISQUALIFIED"] } },
    orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }], take: limit * 3, select: { id: true, name: true, domain: true },
  });
  const suggestions = await db.prospectSuggestion.findMany({ where: { sellerId, status: "new", domain: { not: null } }, orderBy: { score: "desc" }, take: limit, select: { id: true, name: true, domain: true, sources: true } });
  const targets = [
    ...accounts.filter((a) => !skip.has(a.domain!)).map((a) => ({ kind: "account" as const, ...a })),
    ...suggestions.filter((s) => !skip.has(s.domain!)).map((s) => ({ kind: "suggestion" as const, ...s })),
  ].slice(0, limit);
  let read = 0, found = 0, matched = 0;
  const changes = new Map<string, string[]>();
  for (const t of targets) {
    if (Date.now() > deadline) break;
    const domain = t.domain!;
    const r = await readCareers(domain, io);
    read++;
    const hits: (Job & { word: string })[] = r.jobs.flatMap((j) => { const w = matchesRole(j.title, words); return w ? [{ ...j, word: w }] : []; }).slice(0, 5);
    if (r.status === "found") found++;
    await db.careersFeed.upsert({
      where: { sellerId_domain: { sellerId, domain } },
      create: { sellerId, domain, accountId: t.kind === "account" ? t.id : null, suggestionId: t.kind === "suggestion" ? t.id : null, ats: r.ats, slug: r.slug, status: r.status, note: r.note, lastCheckedAt: now, lastJobs: r.jobs.slice(0, 40).map((j) => ({ ...j, matched: Boolean(matchesRole(j.title, words)) })) as unknown as Prisma.InputJsonValue },
      update: { ats: r.ats, slug: r.slug, status: r.status, note: r.note, lastCheckedAt: now, lastJobs: r.jobs.slice(0, 40).map((j) => ({ ...j, matched: Boolean(matchesRole(j.title, words)) })) as unknown as Prisma.InputJsonValue },
    });
    if (!hits.length) continue;
    if (t.kind === "account") {
      const key = p.researchQuestions.find((q) => q.key === "trigger")?.key ?? p.researchQuestions.find((q) => q.trigger)?.key ?? "trigger";
      for (const j of hits) {
        const canonical = canonicalUrl(j.url);
        if (await db.evidence.findFirst({ where: { accountId: t.id, canonicalUrl: canonical }, select: { id: true } })) continue;
        await db.evidence.create({
          data: {
            sellerId, accountId: t.id, key, claim: `${t.name} is hiring: ${j.title}`.slice(0, 240), value: null,
            sourceUrl: j.url, canonicalUrl: canonical, sourceType: "careers", publishedAt: j.postedAt && j.postedAt <= now ? j.postedAt : now, pageDate: j.postedAt, undated: !j.postedAt,
            status: "probable", pass: "refresh", engine: "careers", quote: j.title, passage: [j.title, j.location, j.postedAt ? `posted ${j.postedAt.toISOString().slice(0, 10)}` : null, `via ${r.ats}`].filter(Boolean).join(" · "),
            publisher: r.ats ? `${r.ats} (${domain})` : domain, retrievedAt: now, fullText: true,
          },
        });
        matched++;
        changes.set(t.id, [...(changes.get(t.id) ?? []), `Hiring: ${j.title}`]);
      }
      const { refreshStatuses } = await import("@/lib/pipeline/stages/research");
      await refreshStatuses(t.id, now);
    } else {
      const src = ((t as { sources: unknown }).sources as { url?: string }[] | null) ?? [];
      const add = hits.filter((j) => !src.some((x) => x.url === j.url)).map((j) => ({ url: j.url, quote: j.title, title: `Hiring: ${j.title}`, at: (j.postedAt ?? now).toISOString(), kind: "job post", trigger: "hiring" }));
      if (add.length) {
        await db.prospectSuggestion.update({ where: { id: t.id }, data: { sources: [...add, ...src].slice(0, 8) as unknown as Prisma.InputJsonValue } });
        matched += add.length;
      }
    }
  }
  return { read, found, matched, changes };
}

/** Re-check top held accounts, rotating so each gets a turn; new facts become "what changed". */
async function recheck(sellerId: string, ctx: RunContext, limit: number, deadline: number) {
  const pool = await db.account.findMany({
    where: { sellerId, mergedIntoId: null, stage: { notIn: ["CUSTOMER", "OPPORTUNITY", "DISQUALIFIED"] }, pipelineStatus: { in: ["done", "idle"] } },
    orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }], take: limit * 4,
  });
  if (!pool.length) return { checked: 0, newFacts: 0, changes: new Map<string, string[]>() };
  const last = await db.pipelineEvent.findMany({ where: { accountId: { in: pool.map((a) => a.id) }, step: "daily.recheck" }, orderBy: { createdAt: "desc" }, select: { accountId: true, createdAt: true } });
  const lastAt = new Map<string, number>();
  for (const e of last) if (e.accountId && !lastAt.has(e.accountId)) lastAt.set(e.accountId, e.createdAt.getTime());
  const order = [...pool].sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0)).slice(0, limit);
  const { s06AccountResearch, refreshStatuses } = await import("@/lib/pipeline/stages/research");
  let checked = 0, newFacts = 0;
  const changes = new Map<string, string[]>();
  for (const a of order as Account[]) {
    if (Date.now() > deadline) break;
    const before = new Set((await db.evidence.findMany({ where: { accountId: a.id }, select: { id: true } })).map((e) => e.id));
    try {
      // A cached search when the question was searched in the last few days: nothing is spent twice.
      await s06AccountResearch(a, ctx, { pass: "refresh", keys: ["trigger"] });
      await refreshStatuses(a.id, ctx.now);
    } catch (e) {
      await logEvent(ctx, { accountId: a.id, stage: 6, step: "daily.recheck", outcome: "info", reason: `Re-check stopped: ${e instanceof Error ? e.message.slice(0, 140) : e}` });
      if (e instanceof Error && /budget|ResearchOff|Live research is off/i.test(`${e.name} ${e.message}`)) break;
      continue;
    }
    const fresh = await db.evidence.findMany({ where: { accountId: a.id, id: { notIn: [...before] }, flagged: false }, select: { claim: true } });
    checked++;
    newFacts += fresh.length;
    if (fresh.length) changes.set(a.id, fresh.slice(0, 3).map((f) => `New: ${f.claim}`));
    await logEvent(ctx, { accountId: a.id, stage: 6, step: "daily.recheck", outcome: fresh.length ? "pass" : "info", reason: fresh.length ? `${fresh.length} new fact(s) since the last check` : "Nothing new since the last check" });
  }
  return { checked, newFacts, changes };
}

/** One client's daily run. Returns a summary; saves today's list. */
export async function runClientDaily(sellerId: string, baseCtx: RunContext, opts: { force?: boolean; budgetMs?: number } = {}) {
  return withSeller(sellerId, async () => {
    const date = istDate(baseCtx.now);
    if (!opts.force && (await db.dailyRecommendation.findUnique({ where: { sellerId_date: { sellerId, date } }, select: { id: true } }))) return null;
    const sample = sellerId === SAMPLE_CLIENT;
    const ctx: RunContext = sample ? { ...baseCtx, adapters: (await import("@/lib/adapters/mock")).createMockAdapters() } : baseCtx;
    const s = dailySettings(seller().daily);
    const started = new Date();
    const end = Date.now() + (opts.budgetMs ?? 200_000);
    const summary: Record<string, unknown> = { stand_ins: sample, settings: s };
    const overBudget = async () => (await spentSince(sellerId, started)) >= s.maxUsd;
    let stopped: string | null = null;
    let changes = new Map<string, string[]>();

    if (s.news && !stopped) {
      try {
        const { scanMarket } = await import("./scan");
        summary.news = await scanMarket(ctx, { budgetMs: Math.min(110_000, end - Date.now() - 60_000) });
      } catch (e) {
        summary.news = { error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
      }
      if (await overBudget()) stopped = `Daily limit of $${s.maxUsd} reached after the news scan`;
    }
    if (s.jobs && !stopped && s.jobAccountsPerDay > 0) {
      // Stand-in services (the Test client, or ADAPTER_MODE=mock) never read a real website.
      const io = sample || !ctx.adapters.research.live ? sampleIO(roleWords(seller())) : await liveIO();
      const j = await jobFeeds(sellerId, ctx, io, s.jobAccountsPerDay, Math.min(end - 40_000, Date.now() + 45_000));
      summary.jobs = { read: j.read, found: j.found, matched: j.matched };
      changes = j.changes;
    }
    if (s.recheck && !stopped && s.recheckPerDay > 0) {
      const r = await recheck(sellerId, ctx, s.recheckPerDay, end - 10_000);
      summary.recheck = { checked: r.checked, newFacts: r.newFacts };
      for (const [k, v] of r.changes) changes.set(k, [...(changes.get(k) ?? []), ...v]);
      if (await overBudget()) stopped = `Daily limit of $${s.maxUsd} reached during re-checks`;
    }
    if (s.lookalikes && !stopped && !sample) {
      const used = await db.pipelineEvent.findMany({ where: { step: "daily.lookalike", createdAt: { gte: new Date(ctx.now.getTime() - 30 * DAY) }, account: { sellerId } }, select: { accountId: true } });
      const seed = await db.account.findFirst({ where: { sellerId, mergedIntoId: null, stage: { in: ["CUSTOMER", "OPPORTUNITY", "MQA", "ENGAGED"] }, id: { notIn: used.map((u) => u.accountId!).filter(Boolean) } }, orderBy: { updatedAt: "desc" } });
      if (seed) {
        try {
          const { findLookalikes } = await import("./lookalike");
          await findLookalikes(seed.domain ?? seed.name, ctx, "daily prospecting");
          await logEvent(ctx, { accountId: seed.id, stage: 0, step: "daily.lookalike", outcome: "info", reason: `Looking for companies like ${seed.name}` });
          summary.lookalikes = { seed: seed.name };
        } catch (e) {
          summary.lookalikes = { error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
        }
      }
    }

    const items = await buildDailyList(sellerId, s, changes, ctx.now);
    summary.spentUsd = Math.round((await spentSince(sellerId, started)) * 1000) / 1000;
    summary.stopped = stopped;
    summary.items = items.length;
    await saveDailyList(sellerId, date, items, summary);
    await logEvent(ctx, { stage: 0, step: "discover.daily", outcome: "pass", reason: `Recommended today: ${items.length} accounts${stopped ? ` (${stopped})` : ""}`, data: { sellerId, ...summary } as unknown as Prisma.InputJsonValue });
    return summary;
  });
}

/** From the morning check: every covered client once a day. */
export async function runDailyProspecting(ctx: RunContext = newContext()) {
  const { recordRun } = await import("@/lib/admin/ops");
  const out: Record<string, unknown> = {};
  for (const id of await dailyClients()) {
    const started = new Date();
    try {
      const r = await runClientDaily(id, ctx);
      if (r) {
        out[id] = r;
        await recordRun(`Daily prospecting · ${id}`, started, { ok: true, processed: Number(r.items ?? 0), note: (r.stopped as string | null) ?? undefined });
      }
    } catch (e) {
      out[id] = { error: e instanceof Error ? e.message : String(e) };
      await recordRun(`Daily prospecting · ${id}`, started, { ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
