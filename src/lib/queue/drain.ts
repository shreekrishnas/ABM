// Background queue drain. Imports mark companies `queued`; this works through them in
// time-boxed slices that fit a serverless request, and chains the next slice until the
// queue is empty — so a big import finishes even after the person closes the page.
//
//   kickDrain(origin) → POST /api/v1/queue → answers 202 at once → after(): drainOnce()
//                       → more left? kickDrain(origin) again → … → empty: stop
//
// A database lease ("queue") makes sure only one chain runs at a time. A lease that
// outlives its run (crashed function) expires and the next kick takes over. The daily
// tick also kicks the drain, so a broken chain resumes within a day at worst.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newContext } from "@/lib/pipeline/context";
import { processQueue } from "@/lib/pipeline/orchestrator";

export const QUEUE_LEASE = "queue";
/** Work per slice. Leaves headroom under the route's 60 s maxDuration for the chain call. */
export const SLICE_MS = 45_000;
/** QUEUE_SLICE_MS overrides the slice (capped at the default, so it can't outrun maxDuration). */
export function sliceMs() {
  const v = Number(process.env.QUEUE_SLICE_MS);
  return Number.isFinite(v) && v > 0 ? Math.min(v, SLICE_MS) : SLICE_MS;
}

/**
 * Take the lease if it is free or expired. Atomic: two workers racing for it can't
 * both win (the conditional upsert runs as one statement).
 */
export async function acquireLease(name: string, holder: string, ttlMs: number, now = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const n = await db.$executeRaw`
    INSERT INTO "JobLease" ("name", "holder", "expiresAt", "updatedAt")
    VALUES (${name}, ${holder}, ${expiresAt}, ${now})
    ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "JobLease"."expiresAt" < ${now} OR "JobLease"."holder" = ${holder}`;
  return n === 1;
}

/** Release the lease (only if we still hold it) and record what the run did. */
export async function releaseLease(name: string, holder: string, result: Prisma.InputJsonValue, now = new Date()) {
  await db.jobLease.updateMany({ where: { name, holder }, data: { expiresAt: now, lastRunAt: now, lastResult: result } });
}

export interface DrainResult {
  status: "drained" | "busy" | "idle";
  processed: number;
  remaining: number;
}

/** One slice of queue work under the lease. "busy" means another worker holds it. */
export async function drainOnce(opts: { budgetMs?: number; holder?: string } = {}): Promise<DrainResult> {
  const queued = await db.account.count({ where: { pipelineStatus: "queued", mergedIntoId: null } });
  if (queued === 0) return { status: "idle", processed: 0, remaining: 0 };
  const holder = opts.holder ?? `drain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const budgetMs = opts.budgetMs ?? sliceMs();
  if (!(await acquireLease(QUEUE_LEASE, holder, budgetMs + 60_000))) return { status: "busy", processed: 0, remaining: queued };
  let r: { processed: number; remaining: number } = { processed: 0, remaining: queued };
  try {
    r = await processQueue({ budgetMs, ctx: newContext() });
    return { status: "drained", processed: r.processed, remaining: r.remaining };
  } finally {
    await releaseLease(QUEUE_LEASE, holder, { processed: r.processed, remaining: r.remaining });
  }
}

/** Should the chain call itself again? Only when there is work left and the slice made progress. */
export function shouldContinue(r: DrainResult) {
  return r.status === "drained" && r.remaining > 0 && r.processed > 0;
}

/** The secret the drain uses to call its own route. */
function selfToken() {
  return process.env.ABM_API_KEY?.trim() || process.env.CRON_SECRET?.trim() || "";
}

/**
 * Start (or continue) the background chain. Fire-and-forget from the caller's point
 * of view: the queue route answers 202 immediately and does the work after responding.
 * `APP_URL` overrides the origin (e.g. when preview deployments are password-protected).
 */
export async function kickDrain(origin: string | null | undefined): Promise<boolean> {
  const base = (process.env.APP_URL?.trim() || origin || "").replace(/\/$/, "");
  if (!base) return false;
  const token = selfToken();
  try {
    const res = await fetch(`${base}/api/v1/queue`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return res.status === 202 || res.status === 200;
  } catch {
    return false;
  }
}

/** For the status panel: how much is waiting and whether a worker is on it. */
export async function queueStatus(now = new Date()) {
  const [queued, running, lease] = await Promise.all([
    db.account.count({ where: { pipelineStatus: "queued", mergedIntoId: null } }),
    db.account.count({ where: { pipelineStatus: "running", mergedIntoId: null } }),
    db.jobLease.findUnique({ where: { name: QUEUE_LEASE } }),
  ]);
  const last = (lease?.lastResult ?? null) as { processed?: number; remaining?: number } | null;
  return {
    queued,
    running,
    working: Boolean(lease && lease.expiresAt > now),
    lastRunAt: lease?.lastRunAt ?? null,
    lastProcessed: last?.processed ?? null,
  };
}
