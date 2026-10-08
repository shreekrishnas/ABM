// Learning loop: measures what works (engines, angles, personas, fit bands, reviewer
// verdicts, fact precision), asks the brain to summarise it, and feeds the result back
// into research routing and drafting.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { newContext, openReview, type RunContext } from "@/lib/pipeline/context";
import { publish } from "./bus";
import { sellerContext } from "@/lib/seller";
import { ruleInsights } from "./rules";
import type { BrainStats, InsightSummary, Rate } from "./types";

const DAY = 86_400_000;

function rates(map: Map<string, { n: number; hits: number }>): Rate[] {
  return [...map.entries()]
    .map(([label, v]) => ({ label, n: v.n, hits: v.hits, rate: v.n ? v.hits / v.n : null, tentative: v.n < CONFIG.brain.minSample }))
    .sort((a, b) => b.n - a.n);
}

function bump(map: Map<string, { n: number; hits: number }>, label: string, hit: boolean) {
  const v = map.get(label) ?? { n: 0, hits: 0 };
  v.n++;
  if (hit) v.hits++;
  map.set(label, v);
}

export async function computeStats(now = new Date()): Promise<BrainStats> {
  const since = new Date(now.getTime() - 120 * DAY);
  const minSample = CONFIG.brain.minSample;

  // Research efficiency per engine × question.
  const searches = await db.researchQuery.findMany({ where: { createdAt: { gte: since } }, select: { engine: true, key: true, cached: true, kept: true, costMicros: true, error: true } });
  const r = new Map<string, { engine: string; key: string; searches: number; cached: number; kept: number; cost: number }>();
  let saved = 0;
  for (const s of searches) {
    const k = `${s.engine}|${s.key}`;
    const v = r.get(k) ?? { engine: s.engine, key: s.key, searches: 0, cached: 0, kept: 0, cost: 0 };
    if (s.cached) {
      v.cached++;
      saved += CONFIG.costsUsd.search[s.engine] ?? 0;
    } else v.searches++;
    v.kept += s.kept;
    v.cost += s.costMicros / 1e6;
    r.set(k, v);
  }
  const research = [...r.values()].map((v) => ({ engine: v.engine, key: v.key, searches: v.searches, cached: v.cached, kept: v.kept, costUsd: Math.round(v.cost * 1000) / 1000, yield: v.searches ? Math.round((v.kept / v.searches) * 100) / 100 : null }));

  // Messaging: positive replies per sent message, by use case / role / trigger / tier.
  const messages = await db.message.findMany({
    where: { sentAt: { gte: since } },
    select: { id: true, contactId: true, draft: { select: { useCase: true, angle: true } }, contact: { select: { buyingRole: true, account: { select: { tier: true } } } }, replies: { select: { class: true } } },
  });
  type Tally = Map<string, { n: number; hits: number }>;
  const [byUseCase, byRole, byTrigger, byTier]: Tally[] = [new Map(), new Map(), new Map(), new Map()];
  for (const m of messages) {
    const positive = m.replies.some((x) => x.class === "positive");
    bump(byUseCase, m.draft.useCase ?? "unknown", positive);
    bump(byRole, m.contact.buyingRole, positive);
    bump(byTrigger, m.draft.angle ?? "unknown", positive);
    bump(byTier, m.contact.account.tier ?? "T3", positive);
  }

  // Reviewer verdicts on drafts.
  const drafts = await db.draft.findMany({ where: { createdAt: { gte: since } }, select: { status: true, reviewerNote: true, reviewedAt: true, claimCheck: true, useCase: true, rewrites: true } });
  const auto = (n: string | null) => !!n && /^Auto-approved/.test(n);
  const withdrawn = (n: string | null) => !!n && /^Withdrawn/.test(n);
  const reviewed = drafts.filter((d) => d.reviewedAt && !auto(d.reviewerNote) && !withdrawn(d.reviewerNote) && ["approved", "sent", "rejected"].includes(d.status));
  const edited = reviewed.filter((d) => d.reviewerNote?.includes("Edited by reviewer")).length;
  const rejected = reviewed.filter((d) => d.status === "rejected").length;
  const [revUseCase, revRewrites]: Tally[] = [new Map(), new Map()];
  for (const d of reviewed) {
    const asIs = d.status !== "rejected" && !d.reviewerNote?.includes("Edited by reviewer");
    bump(revUseCase, d.useCase ?? "unknown", asIs);
    bump(revRewrites, d.rewrites === 0 ? "first version" : `${d.rewrites} rewrite(s)`, asIs);
  }

  // LinkedIn journeys: how far people got, by sender and role (the main channel today).
  const journeys = await db.journey.findMany({ where: { updatedAt: { gte: since } }, select: { stage: true, sender: { select: { name: true } }, contact: { select: { buyingRole: true } } } });
  const [liSender, liRole]: Tally[] = [new Map(), new Map()];
  const advanced = new Set(["interested", "call_scheduled", "demo_scheduled", "opportunity", "closed_won"]);
  for (const j of journeys) {
    if (j.stage === "not_contacted") continue;
    bump(liSender, j.sender.name, advanced.has(j.stage));
    bump(liRole, j.contact.buyingRole, advanced.has(j.stage));
  }

  const claimEvents = await db.pipelineEvent.count({ where: { step: "draft_review.claim_check", outcome: "block", createdAt: { gte: since } } });
  const review = {
    reviewed: reviewed.length,
    approvedAsIs: reviewed.length - edited - rejected,
    edited,
    rejected,
    guardrailBlocked: drafts.filter((d) => d.status === "blocked").length,
    claimChecks: drafts.filter((d) => d.claimCheck != null).length,
    claimsUnsupported: claimEvents,
  };

  // Fact precision: facts people flagged as wrong, by engine.
  const ev = await db.evidence.findMany({ where: { createdAt: { gte: since } }, select: { engine: true, flagged: true } });
  const byEngine = new Map<string, { n: number; hits: number }>();
  for (const e of ev) bump(byEngine, e.engine ?? "unknown", e.flagged);

  // Fit calibration: of accounts we emailed, how many replied positively or opened a deal.
  const emailed = await db.account.findMany({
    where: { contacts: { some: { messages: { some: { sentAt: { gte: since } } } } } },
    select: { fitScore: true, opportunities: { select: { id: true } }, contacts: { select: { replies: { select: { class: true } } } } },
  });
  const fit = new Map<string, { n: number; hits: number }>();
  for (const a of emailed) {
    const band = (a.fitScore ?? 0) >= 80 ? "fit 80+" : (a.fitScore ?? 0) >= 60 ? "fit 60–79" : "fit 40–59";
    bump(fit, band, a.opportunities.length > 0 || a.contacts.some((c) => c.replies.some((x) => x.class === "positive")));
  }

  return {
    generatedAt: now.toISOString(),
    research,
    creditsSavedUsd: Math.round(saved * 1000) / 1000,
    messaging: { byUseCase: rates(byUseCase), byRole: rates(byRole), byTrigger: rates(byTrigger), byTier: rates(byTier) },
    review,
    facts: { total: ev.length, flagged: ev.filter((e) => e.flagged).length, byEngine: rates(byEngine) },
    fit: rates(fit).sort((a, b) => a.label.localeCompare(b.label)),
    reviewer: { byUseCase: rates(revUseCase), byRewrites: rates(revRewrites) },
    linkedin: { bySender: rates(liSender), byRole: rates(liRole) },
    minSample,
  };
}

/** Best engine per question key, once an engine has enough searches to judge. */
export async function engineRouting(): Promise<Record<string, string>> {
  const rows = await db.researchQuery.groupBy({
    by: ["engine", "key"],
    where: { cached: false, error: null, engine: { notIn: ["mock"] }, createdAt: { gte: new Date(Date.now() - 120 * DAY) } },
    _count: { _all: true },
    _sum: { kept: true },
  });
  const best: Record<string, { engine: string; y: number }> = {};
  for (const r of rows) {
    if (r._count._all < CONFIG.brain.minSample) continue;
    const y = (r._sum.kept ?? 0) / r._count._all;
    if (!best[r.key] || y > best[r.key].y) best[r.key] = { engine: r.engine, y };
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.engine]));
}

export interface StoredInsight extends InsightSummary {
  id: string;
  model: string;
  createdAt: Date;
  stats: BrainStats;
}

export async function latestInsight(): Promise<StoredInsight | null> {
  const row = await db.brainInsight.findFirst({ orderBy: { createdAt: "desc" } });
  return row ? { ...(row.summary as unknown as InsightSummary), id: row.id, model: row.model, createdAt: row.createdAt, stats: row.stats as unknown as BrainStats } : null;
}

/** Messaging learnings handed to the draft writer and strategist (advice, not facts). */
export async function latestLearnings(): Promise<string[]> {
  const i = await latestInsight();
  if (!i) return [];
  return [...i.recommendations.filter((r) => r.area === "messaging").map((r) => r.text), ...i.working.map((w) => `${w.text} (${w.evidence})`)].slice(0, CONFIG.brain.learningsInDrafts);
}

export async function generateInsights(ctx: RunContext = newContext()): Promise<StoredInsight> {
  const stats = await computeStats(ctx.now);
  let summary: InsightSummary;
  let model = ctx.adapters.llm.model;
  try {
    summary = await ctx.adapters.llm.insights(stats);
  } catch {
    summary = ruleInsights(stats);
    model = "rules";
  }
  const row = await db.brainInsight.create({ data: { stats: stats as unknown as Prisma.InputJsonValue, summary: summary as unknown as Prisma.InputJsonValue, model, createdAt: ctx.now } });
  await publish(ctx, { type: "learning.summary", module: "learning_analyst", payload: { headline: summary.headline, model } });
  await proposeImprovements(summary, stats, ctx);
  return { ...summary, id: row.id, model, createdAt: row.createdAt, stats };
}

/**
 * Self-improver: turns findings into proposals. Research routing is applied on its own
 * (engineRouting); everything else — messaging, targeting, process — is only proposed:
 * a person accepts it, and the change ships with a test. Never changes rules by itself.
 */
export async function proposeImprovements(summary: InsightSummary, stats: BrainStats, ctx: RunContext) {
  const sp = sellerContext().pack;
  const sample = Math.max(stats.review.reviewed, stats.facts.total, ...stats.messaging.byUseCase.map((r) => r.n), ...stats.linkedin.bySender.map((r) => r.n), 0);
  for (const r of summary.recommendations) {
    if (r.area === "research" || /^Keep collecting/.test(r.text)) continue;
    const open = await db.proposal.findFirst({ where: { sellerId: sp.id, change: r.text, status: "proposed" } });
    if (open) continue;
    const tentative = sample < stats.minSample;
    const evidence = [...summary.working, ...summary.notWorking].map((w) => `${w.text} (${w.evidence})`).join("; ").slice(0, 600) || "See the latest learning summary";
    const p = await db.proposal.create({ data: { sellerId: sp.id, area: r.area === "targeting" ? "icp" : r.area === "process" ? "rules" : r.area, change: r.text, rationale: summary.headline, evidence, sampleSize: sample, tentative, createdAt: ctx.now } });
    await publish(ctx, { type: "proposal.created", module: "self_improver", payload: { proposalId: p.id, area: p.area, tentative } });
    await openReview({ type: "other", stage: 12, reason: `${tentative ? "Tentative proposal" : "Proposal"} (${p.area}): ${r.text}`.slice(0, 300), payload: { proposalId: p.id, evidence } });
  }
}

/** Called from the scheduled tick: refresh the summary once a week. */
export async function maybeGenerateInsights(ctx: RunContext) {
  const last = await db.brainInsight.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && ctx.now.getTime() - last.createdAt.getTime() < CONFIG.brain.insightEveryDays * DAY) return false;
  await generateInsights(ctx);
  return true;
}
