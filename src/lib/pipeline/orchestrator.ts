// Runs accounts through stages 2–11. Stages 12–13 are event-driven (sends,
// signals, replies). Every outcome — pass, stop, budget, crash — is recorded.

import type { Account } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { BudgetExceeded, budgetFor, logEvent, newContext, openReview, spentUsd, StopRun, type RunContext } from "./context";
import { s02CleanNormalize, s03FitTier, s04Identity } from "./stages/data";
import { gapSearch, s05ResearchPlan, s06AccountResearch, s07AccountTwin } from "./stages/research";
import { fillGaps } from "@/lib/research/intake";
import { s08BuyingGroup, s09Enrichment } from "./stages/people";
import { s10Readiness, s11DraftReview } from "./stages/outreach";
import { escalateOverdue, recomputeAccount, sendApproved, tickSequences } from "./stages/engagement";
import { maybeGenerateInsights } from "@/lib/brain/insights";
import { publish } from "@/lib/brain/bus";
import { decide } from "@/lib/brain/decisions";
import { latestBrief } from "@/lib/brain/strategist";
import { loadSeller, sellerContext, withSeller } from "@/lib/seller";
import { isTriggerKey } from "@/lib/research/keys";
import { evidenceQuality } from "./gates";
import { liveEvidence } from "./stages/research";

type StageFn = (a: Account, ctx: RunContext) => Promise<Account>;

const LINEAR: [number, StageFn][] = [
  // Stage 2 includes the intake gap fill: research what the import left out before fit and identity run.
  [2, async (a, ctx) => fillGaps(await s02CleanNormalize(a, ctx), ctx, gapSearch)],
  [3, s03FitTier],
  [4, s04Identity],
  [5, (a, ctx) => s05ResearchPlan(a, ctx, "initial")],
  [6, (a, ctx) => s06AccountResearch(a, ctx, { pass: "main" })],
  [7, (a, ctx) => s07AccountTwin(a, ctx)],
  [8, s08BuyingGroup],
  [9, s09Enrichment],
];

export interface RunResult {
  accountId: string;
  status: "done" | "blocked" | "error" | "skipped";
  reachedStage: number;
  reason: string;
  runId: string;
}

const LOCK_TTL_MS = 10 * 60_000;

async function acquireLock(accountId: string, now: Date): Promise<boolean> {
  const r = await db.account.updateMany({
    where: { id: accountId, mergedIntoId: null, OR: [{ pipelineStatus: { not: "running" } }, { lastRunAt: { lt: new Date(now.getTime() - LOCK_TTL_MS) } }] },
    data: { pipelineStatus: "running", lastRunAt: now, queuedFromStage: null },
  });
  return r.count === 1;
}

/**
 * Run one account from `fromStage` (default: the stage after the last completed
 * one) through drafting. Re-running a finished account is a no-op unless
 * `fromStage` is given.
 */
export async function runAccount(accountId: string, opts: { fromStage?: number; ctx?: RunContext; reason?: "initial" | "refresh" | "intent_surge" } = {}): Promise<RunResult> {
  const ctx = opts.ctx ?? newContext();
  const found = await db.account.findUnique({ where: { id: accountId }, select: { sellerId: true } });
  if (!found) return { accountId, status: "error", reachedStage: 0, reason: "Account not found", runId: ctx.runId };
  // Seller context module: the account's seller pack becomes the brain's identity for the whole run.
  let sellerOk = true;
  try {
    loadSeller(found.sellerId);
  } catch (e) {
    sellerOk = false;
    await logEvent(ctx, { accountId, stage: 1, step: "seller.context", outcome: "error", reason: e instanceof Error ? e.message : String(e) });
  }
  if (!sellerOk) return { accountId, status: "error", reachedStage: 0, reason: `Seller pack "${found.sellerId}" missing or invalid`, runId: ctx.runId };
  return withSeller(found.sellerId, () => runWithSeller(accountId, opts, ctx));
}

/** Main brain: plans the run, runs the modules in order, resolves conflicts, enforces loop caps and budget. */
async function runWithSeller(accountId: string, opts: { fromStage?: number; reason?: "initial" | "refresh" | "intent_surge" }, ctx: RunContext): Promise<RunResult> {
  let account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { accountId, status: "error", reachedStage: 0, reason: "Account not found", runId: ctx.runId };
  if (account.mergedIntoId) return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: "Merged into another account", runId: ctx.runId };
  if (["CUSTOMER", "OPPORTUNITY"].includes(account.stage) && !opts.fromStage)
    return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: `Account is ${account.stage.toLowerCase()}`, runId: ctx.runId };

  const from = opts.fromStage ?? Math.max(2, account.pipelineStage + 1);
  if (from > 11) return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: "Already through drafting", runId: ctx.runId };
  if (!(await acquireLock(accountId, ctx.now))) return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: "Already running", runId: ctx.runId };

  let stage = from;
  const sc = sellerContext();
  await publish(ctx, { type: "seller.context", module: "seller_context", accountId, payload: { sellerId: sc.pack.id, version: sc.version, seller: sc.pack.name } });
  await publish(ctx, {
    type: "run.planned", module: "main_brain", accountId,
    payload: { fromStage: from, modules: LINEAR.filter(([n]) => n >= from).map(([n]) => MODULE_OF[n]).concat(from <= 11 ? ["readiness_gate", "writer", "critic_panel", "rewriter"] : []), budgetUsd: budgetFor(account.tier), loopCaps: CONFIG.loops, reason: opts.reason ?? "initial" },
  });
  try {
    for (const [n, fn] of LINEAR) {
      if (n < from) continue;
      stage = n;
      account = n === 5 && opts.reason ? await s05ResearchPlan(account, ctx, opts.reason) : await fn(account, ctx);
      account = await db.account.update({ where: { id: accountId }, data: { pipelineStage: n } });
      await afterModule(n, account, ctx);
    }

    if (from <= 10) {
      stage = 10;
      let r = await s10Readiness(account, ctx);
      await publish(ctx, { type: "readiness.decided", module: "readiness_gate", accountId, payload: { ready: r.ready, reResearch: r.reResearch } });
      if (r.reResearch) {
        // Loop 1: one targeted re-research pass on the trigger question, then decide again.
        account = await db.account.update({ where: { id: accountId }, data: { followupUsed: true } });
        await s06AccountResearch(account, ctx, { pass: "followup", keys: ["trigger"] });
        account = await s07AccountTwin(account, ctx, { allowReopen: false });
        r = await s10Readiness(account, ctx);
        if (r.reResearch) throw new StopRun("Evidence still weak after re-research");
      }
      account = await db.account.update({ where: { id: accountId }, data: { pipelineStage: 10 } });
    }

    stage = 11;
    account = await s11DraftReview(account, ctx);
    account = await db.account.update({ where: { id: accountId }, data: { pipelineStage: 11, pipelineStatus: "done" } });
    await recomputeAccount(accountId, ctx);
    await publish(ctx, { type: "run.finished", module: "main_brain", accountId, payload: { status: "done", reachedStage: 11 } });
    return { accountId, status: "done", reachedStage: 11, reason: "Drafts queued", runId: ctx.runId };
  } catch (e) {
    await publish(ctx, { type: "run.finished", module: "main_brain", accountId, payload: { status: e instanceof StopRun || e instanceof BudgetExceeded ? "blocked" : "error", reachedStage: stage, reason: e instanceof Error ? e.message.slice(0, 200) : e instanceof StopRun ? e.reason : String(e) } }).catch(() => undefined);
    if (e instanceof StopRun) {
      await db.account.update({ where: { id: accountId }, data: { pipelineStatus: "blocked", pipelineStage: Math.max(stage - 1, 1) } });
      await logEvent(ctx, { accountId, stage, step: "orchestrator.stop", outcome: "block", reason: e.reason });
      return { accountId, status: "blocked", reachedStage: stage, reason: e.reason, runId: ctx.runId };
    }
    if (e instanceof BudgetExceeded) {
      await db.account.update({ where: { id: accountId }, data: { pipelineStatus: "blocked", pipelineStage: Math.max(stage - 1, 1) } });
      await openReview({ type: "budget_exceeded", stage, accountId, reason: e.message, payload: { spentUsd: e.spentUsd, capUsd: e.capUsd } });
      await logEvent(ctx, { accountId, stage, step: "orchestrator.budget", outcome: "block", reason: e.message });
      return { accountId, status: "blocked", reachedStage: stage, reason: e.message, runId: ctx.runId };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await db.account.update({ where: { id: accountId }, data: { pipelineStatus: "error", pipelineStage: Math.max(stage - 1, 1) } });
    await logEvent(ctx, { accountId, stage, step: "orchestrator.error", outcome: "error", reason: msg.slice(0, 500) });
    return { accountId, status: "error", reachedStage: stage, reason: msg, runId: ctx.runId };
  }
}

const MODULE_OF: Record<number, string> = { 2: "intake", 3: "fit", 4: "contact_verifier", 5: "planner", 6: "search_router+extractor", 7: "evidence_judge+account_twin+strategist", 8: "buying_group", 9: "contact_verifier" };

/** What each module reports on the bus, and the main brain's conflict rule after the strategist. */
async function afterModule(n: number, account: Account, ctx: RunContext) {
  if (n === 3) await publish(ctx, { type: "fit.scored", module: "fit", accountId: account.id, payload: { fit: account.fitScore, tier: account.tier } });
  if (n === 6) await publish(ctx, { type: "research.done", module: "search_router", accountId: account.id, payload: { facts: await db.evidence.count({ where: { accountId: account.id, supersededById: null, flagged: false } }) } });
  if (n !== 7) return;
  const evidence = await liveEvidence(account.id);
  const triggers = evidence.filter((e) => isTriggerKey(e.key));
  const q = evidenceQuality(triggers.map((t) => ({ status: t.status, publishedAt: t.publishedAt })), ctx.now);
  await publish(ctx, { type: "evidence.judged", module: "evidence_judge", accountId: account.id, payload: { strong: q.strong, verified: q.verified, usable: q.usable } });
  const brief = await latestBrief(account.id);
  if (!brief) return;
  await publish(ctx, { type: "brief.ready", module: "strategist", accountId: account.id, payload: { verdict: brief.verdict, painPoints: brief.painPoints.length } });
  // Conflict: the strategist is upbeat but the evidence judge is not. The weaker verdict wins until re-research.
  if (brief.verdict === "strong" && !q.strong) {
    await publish(ctx, { type: "verdict.conflict", module: "main_brain", accountId: account.id, payload: { strategist: "strong", evidenceJudge: "weak", winner: "evidence_judge" } });
    await decide(ctx, {
      module: "main_brain", question: `Is ${account.name} ready for outreach?`, choice: "Not yet — the weaker verdict (evidence) wins until re-research",
      caseFor: `Strategist: ${brief.verdictWhy}`, caseAgainst: `Evidence judge: only ${q.verified} verified / ${q.usable} usable trigger(s) in ${CONFIG.readiness.triggerWindowDays} days`,
      evidenceFor: brief.whyNow?.factIds ?? [], evidenceAgainst: triggers.map((t) => t.id), confidence: 0.6, autonomy: "acted", accountId: account.id,
    });
  }
}

export async function runBatch(accountIds: string[], ctx: RunContext = newContext()) {
  const results: RunResult[] = [];
  for (const id of accountIds) results.push(await runAccount(id, { ctx }));
  return results;
}

/** Due watchlist entries go back to stage 5 with loop counters reset. */
export async function processWatchlist(ctx: RunContext = newContext()) {
  const due = await db.watchlistEntry.findMany({ where: { status: { in: ["waiting", "due"] }, recheckAt: { lte: ctx.now } } });
  const results: RunResult[] = [];
  for (const w of due) {
    await db.watchlistEntry.update({ where: { id: w.id }, data: { status: "processed" } });
    await db.account.update({ where: { id: w.accountId }, data: { followupUsed: false, reopenUsed: false, stage: "RECYCLED", pipelineStatus: "idle" } });
    await logEvent(ctx, { accountId: w.accountId, stage: 5, step: "research_plan.refresh_trigger", outcome: "info", reason: `Watchlist re-check due: ${w.reason}` });
    results.push(await runAccount(w.accountId, { fromStage: 5, ctx, reason: "refresh" }));
  }
  return results;
}

/** Intent surge on a watched account pulls it back into research early. */
export async function processIntent(ctx: RunContext = newContext()) {
  const watched = await db.account.findMany({ where: { stage: { in: ["WATCH", "RECYCLED"] }, mergedIntoId: null, domain: { not: null } } });
  const results: RunResult[] = [];
  for (const a of watched) {
    const i = await ctx.adapters.intent.intent(a.domain!);
    await db.account.update({ where: { id: a.id }, data: { intentScore: i.score } });
    if (i.score >= CONFIG.intent.surgeThreshold) {
      // Negative-evidence watches (layoffs) are not overridden by intent.
      const negativeWatch = await db.watchlistEntry.findFirst({ where: { accountId: a.id, status: "waiting", reason: { contains: "layoffs" } } });
      if (negativeWatch) continue;
      await db.signal.create({ data: { accountId: a.id, type: "intent_surge", points: CONFIG.engagement.points.intent_surge, anonymous: true, source: "intent_provider", detail: i.topics.join(", ") } });
      await db.watchlistEntry.updateMany({ where: { accountId: a.id, status: "waiting" }, data: { status: "cancelled" } });
      await db.account.update({ where: { id: a.id }, data: { followupUsed: false, reopenUsed: false, pipelineStatus: "idle" } });
      await logEvent(ctx, { accountId: a.id, stage: 5, step: "research_plan.refresh_trigger", outcome: "info", reason: `Intent surge ${i.score} (${i.topics.join(", ") || "category"}) — re-researching early` });
      results.push(await runAccount(a.id, { fromStage: 5, ctx, reason: "intent_surge" }));
    }
  }
  return results;
}

/**
 * Work through accounts queued by imports, within a time budget so it fits a
 * serverless request. Call repeatedly until `remaining` is 0. Accounts sales
 * already owns (opportunity / customer) are updated but not re-run.
 */
export async function processQueue(opts: { batchId?: string; budgetMs?: number; max?: number; ctx?: RunContext } = {}) {
  const ctx = opts.ctx ?? newContext();
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  const where = { pipelineStatus: "queued", mergedIntoId: null, ...(opts.batchId ? { lastImportBatchId: opts.batchId } : {}) };
  const results: RunResult[] = [];
  while (Date.now() < deadline && results.length < (opts.max ?? 500)) {
    const next = await db.account.findFirst({ where, orderBy: { updatedAt: "asc" } });
    if (!next) break;
    if (["CUSTOMER", "OPPORTUNITY"].includes(next.stage)) {
      await db.account.update({ where: { id: next.id }, data: { pipelineStatus: "done", queuedFromStage: null } });
      await logEvent(ctx, { accountId: next.id, stage: 1, step: "data_input.queue", outcome: "info", reason: `Updated by import; not re-run because the account is ${next.stage.toLowerCase()} (sales owns it)` });
      results.push({ accountId: next.id, status: "skipped", reachedStage: next.pipelineStage, reason: "Owned by sales", runId: ctx.runId });
      continue;
    }
    const r = await runAccount(next.id, { fromStage: next.queuedFromStage ?? 2, ctx });
    if (r.status === "skipped" && r.reason === "Already running") {
      // Another worker has it; don't spin on the same account.
      await db.account.updateMany({ where: { id: next.id, pipelineStatus: "queued" }, data: { updatedAt: new Date() } });
    }
    results.push(r);
  }
  const remaining = await db.account.count({ where });
  if (opts.batchId) {
    const batch = await db.importBatch.findUnique({ where: { id: opts.batchId } });
    if (batch) {
      await db.importBatch.update({
        where: { id: batch.id },
        data: { processed: Math.max(0, batch.toProcess - remaining), ...(remaining === 0 && batch.status === "processing" ? { status: "done", finishedAt: new Date() } : {}) },
      });
    }
  } else if (remaining === 0) {
    await db.importBatch.updateMany({ where: { status: "processing" }, data: { status: "done", finishedAt: new Date() } });
  }
  return { processed: results.length, remaining, results };
}

/** The scheduler's job: what a cron would run every few minutes. */
export async function tick(ctx: RunContext = newContext()) {
  const queue = await processQueue({ ctx, budgetMs: 30_000 });
  const sequences = await tickSequences(ctx);
  const sent = await sendApproved(ctx);
  const watch = await processWatchlist(ctx);
  const escalated = await escalateOverdue(ctx);
  const insights = await maybeGenerateInsights(ctx);
  return { queue: { processed: queue.processed, remaining: queue.remaining }, sequences, sent, watchlist: watch.length, escalated, insights };
}

export async function budgetSummary(account: Account) {
  return { spentUsd: await spentUsd(account.id), capUsd: budgetFor(account.tier) };
}
