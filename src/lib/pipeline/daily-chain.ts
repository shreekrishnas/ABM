// The daily check as a chain of steps (core → intel → intent → market → agent → queue), each run
// in its own request. This module holds the logic so it can be tested without HTTP:
//
//   claim (per-day lease) → "started" row → run the step → "completed"/"failed"/"skipped" row
//   → hand off to the next step (whatever happened to this one: steps are independent)
//
// Every row and log line carries the run id, so one day's run can be followed end to end.
// RunLog names: "Daily check" (core) / "Daily check · <step>" for the outcome, with
// " · started" for the start, and "Daily check · handoff" for a hand-off that failed.

import { handOff, logStage, selfBaseUrl, type HandoffResult } from "./handoff";
import type { TickStep } from "./orchestrator";

export const STEPS = ["core", "intel", "intent", "market", "agent"] as const satisfies readonly TickStep[];

export const stepLabel = (step: string) => (step === "core" ? "Daily check" : `Daily check · ${step}`);

/** Steps that only spend AI: skipped (and said so) while AI is paused. */
const AI_ONLY: readonly string[] = ["intel", "market"];

export interface ChainDeps {
  runTick: (step: TickStep) => Promise<unknown>;
  claim: (step: string, runId: string, now: Date) => Promise<{ ok: true } | { ok: false; reason: "running" | "done"; holder: string }>;
  finish: (step: string, runId: string, outcome: { ok: boolean; note?: string }, claimedAt: Date) => Promise<void>;
  record: (job: string, startedAt: Date, r: { ok?: boolean; note?: string | null }) => Promise<void>;
  recordError: (source: string, err: unknown, detail?: string) => Promise<void>;
  aiPaused: () => Promise<boolean>;
  handOff: typeof handOff;
  kickDrain: (origin: string, runId: string) => Promise<boolean>;
  now?: () => Date;
}

export type BeginResult = { status: "claimed"; claimedAt: Date } | { status: "skipped"; reason: "running" | "done" };

/** Take today's lease for the step and record that it started (or why it was skipped). */
export async function beginStep(step: TickStep, runId: string, d: ChainDeps): Promise<BeginResult> {
  const now = d.now?.() ?? new Date();
  const claim = await d.claim(step, runId, now);
  if (!claim.ok) {
    const why = claim.reason === "done" ? "already completed today" : "already running";
    await d.record(stepLabel(step), now, { ok: true, note: `skipped (${why}) run=${runId} holder=${claim.holder}` });
    logStage({ runId, step, state: "skipped", reason: claim.reason, holder: claim.holder });
    return { status: "skipped", reason: claim.reason };
  }
  await d.record(`${stepLabel(step)} · started`, now, { ok: true, note: `run=${runId}` });
  logStage({ runId, step, state: "started" });
  return { status: "claimed", claimedAt: now };
}

/** Run a claimed step and record how it ended. Never throws. */
export async function executeStep(step: TickStep, runId: string, claimedAt: Date, d: ChainDeps): Promise<{ ok: boolean; result?: unknown }> {
  const startedAt = d.now?.() ?? new Date();
  try {
    if (AI_ONLY.includes(step) && (await d.aiPaused())) {
      await d.record(stepLabel(step), startedAt, { ok: true, note: `skipped (AI paused) run=${runId}` });
      await d.finish(step, runId, { ok: true, note: "skipped: AI paused" }, claimedAt);
      logStage({ runId, step, state: "skipped", reason: "ai_paused" });
      return { ok: true };
    }
    const result = await d.runTick(step);
    const note = `completed run=${runId} ${JSON.stringify(result)}`;
    await d.record(stepLabel(step), startedAt, { ok: true, note });
    await d.finish(step, runId, { ok: true }, claimedAt);
    logStage({ runId, step, state: "completed", ms: Date.now() - startedAt.getTime() });
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await d.record(stepLabel(step), startedAt, { ok: false, note: `failed run=${runId}: ${msg}` });
    await d.recordError(`daily check · ${step}`, e, `run=${runId}`);
    await d.finish(step, runId, { ok: false, note: msg }, claimedAt).catch(() => undefined);
    logStage({ runId, step, state: "failed", error: msg.slice(0, 200) });
    return { ok: false };
  }
}

/** Start whatever comes after `step`: the next step, or the research queue after the last. */
export async function continueChain(step: TickStep, runId: string, origin: string, d: ChainDeps): Promise<HandoffResult | { ok: boolean; outcome: "queue" }> {
  const next = STEPS[STEPS.indexOf(step) + 1];
  const base = selfBaseUrl(origin);
  if (!next) {
    const ok = await d.kickDrain(base, runId).catch(() => false);
    logStage({ runId, step: "queue", state: ok ? "handoff_accepted" : "handoff_failed" });
    if (!ok) await d.record("Daily check · handoff", d.now?.() ?? new Date(), { ok: false, note: `→ queue not started run=${runId}` });
    return { ok, outcome: "queue" };
  }
  const r = await d.handOff({ url: `${base}/api/v1/tick?step=${next}&run=${runId}`, runId });
  logStage({ runId, from: step, to: next, state: r.ok ? "handoff_accepted" : "handoff_failed", outcome: r.outcome, status: r.status, host: r.host, attempts: r.attempts, ms: r.ms });
  if (!r.ok) {
    const note = `→ ${next} ${r.outcome}${r.status ? ` ${r.status}` : ""} host=${r.host || "none"} attempts=${r.attempts} run=${runId}${r.detail ? `: ${r.detail}` : ""}`;
    await d.record("Daily check · handoff", d.now?.() ?? new Date(), { ok: false, note });
    await d.recordError("daily check · handoff", new Error(`Hand-off to ${next} failed: ${r.outcome}${r.status ? ` (${r.status})` : ""}`), note);
  }
  return r;
}
