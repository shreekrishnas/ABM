// Runs accounts through stages 2–11. Stages 12–13 are event-driven (sends,
// signals, replies). Every outcome — pass, stop, budget, crash — is recorded.

import type { Account } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { BudgetExceeded, budgetFor, logEvent, newContext, openReview, spentUsd, StopRun, type RunContext } from "./context";
import { s02CleanNormalize, s03FitTier, s04Identity } from "./stages/data";
import { s05ResearchPlan, s06AccountResearch, s07AccountTwin } from "./stages/research";
import { s08BuyingGroup, s09Enrichment } from "./stages/people";
import { s10Readiness, s11DraftReview } from "./stages/outreach";
import { escalateOverdue, recomputeAccount, sendApproved, tickSequences } from "./stages/engagement";

type StageFn = (a: Account, ctx: RunContext) => Promise<Account>;

const LINEAR: [number, StageFn][] = [
  [2, s02CleanNormalize],
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
    data: { pipelineStatus: "running", lastRunAt: now },
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
  let account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { accountId, status: "error", reachedStage: 0, reason: "Account not found", runId: ctx.runId };
  if (account.mergedIntoId) return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: "Merged into another account", runId: ctx.runId };
  if (["CUSTOMER", "OPPORTUNITY"].includes(account.stage) && !opts.fromStage)
    return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: `Account is ${account.stage.toLowerCase()}`, runId: ctx.runId };

  const from = opts.fromStage ?? Math.max(2, account.pipelineStage + 1);
  if (from > 11) return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: "Already through drafting", runId: ctx.runId };
  if (!(await acquireLock(accountId, ctx.now))) return { accountId, status: "skipped", reachedStage: account.pipelineStage, reason: "Already running", runId: ctx.runId };

  let stage = from;
  try {
    for (const [n, fn] of LINEAR) {
      if (n < from) continue;
      stage = n;
      account = n === 5 && opts.reason ? await s05ResearchPlan(account, ctx, opts.reason) : await fn(account, ctx);
      account = await db.account.update({ where: { id: accountId }, data: { pipelineStage: n } });
    }

    if (from <= 10) {
      stage = 10;
      let r = await s10Readiness(account, ctx);
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
    return { accountId, status: "done", reachedStage: 11, reason: "Drafts queued", runId: ctx.runId };
  } catch (e) {
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

/** The scheduler's job: what a cron would run every few minutes. */
export async function tick(ctx: RunContext = newContext()) {
  const sequences = await tickSequences(ctx);
  const sent = await sendApproved(ctx);
  const watch = await processWatchlist(ctx);
  const escalated = await escalateOverdue(ctx);
  return { sequences, sent, watchlist: watch.length, escalated };
}

export async function budgetSummary(account: Account) {
  return { spentUsd: await spentUsd(account.id), capUsd: budgetFor(account.tier) };
}
