// A per-day lease for each step of the daily check, so a step runs at most once a day even if a
// hand-off is retried, the scheduler fires twice, or someone presses "Run now" mid-chain.
//
// - claimStep: takes the lease for today, or reports why not ("running" elsewhere, or "done").
// - finishStep: on success holds the lease past the end of the day (so a repeat is skipped);
//   on failure releases it at once (so a later, deliberate re-run can try again).

import { baseDb } from "@/lib/db-base";
import { stepLeaseName } from "./handoff";

// Longer than any Vercel function can live (800s at most; runs of 337s have been seen here despite
// maxDuration 300), so a lease never expires while its step is still running: no overlap.
export const RUNNING_TTL_MS = 15 * 60_000;
const DONE_TTL_MS = 36 * 3_600_000;

export type Claim = { ok: true } | { ok: false; reason: "running" | "done"; holder: string };

export async function claimStep(step: string, runId: string, now = new Date()): Promise<Claim> {
  const name = stepLeaseName(step, now);
  const expiresAt = new Date(now.getTime() + RUNNING_TTL_MS);
  const n = await baseDb.$executeRaw`
    INSERT INTO "JobLease" ("name", "holder", "expiresAt", "updatedAt")
    VALUES (${name}, ${runId}, ${expiresAt}, ${now})
    ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt", "lastResult" = NULL
    WHERE "JobLease"."expiresAt" < ${now}`;
  if (n === 1) return { ok: true };
  const held = await baseDb.jobLease.findUnique({ where: { name }, select: { holder: true, lastResult: true } });
  const done = (held?.lastResult as { status?: string } | null)?.status === "completed";
  return { ok: false, reason: done ? "done" : "running", holder: held?.holder ?? "" };
}

/** `claimedAt` = the time passed to claimStep, so a step that runs past midnight finds its own lease. */
export async function finishStep(step: string, runId: string, outcome: { ok: boolean; note?: string }, claimedAt: Date, now = new Date()) {
  const name = stepLeaseName(step, claimedAt);
  await baseDb.jobLease.updateMany({
    where: { name, holder: runId },
    data: {
      expiresAt: outcome.ok ? new Date(now.getTime() + DONE_TTL_MS) : now,
      lastRunAt: now,
      lastResult: { status: outcome.ok ? "completed" : "failed", runId, note: outcome.note?.slice(0, 200) ?? null },
    },
  });
}

/** Old daily step leases are only history: keep a week. */
export async function pruneStepLeases(now = new Date()) {
  await baseDb.jobLease.deleteMany({ where: { name: { startsWith: "tick:" }, updatedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } }).catch(() => undefined);
}
