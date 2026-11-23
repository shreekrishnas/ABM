// The daily check as a chain of steps (core → intel → intent → market → agent → queue), each run
// in its own request (the queue in this one when it can't be started on its own). This module holds the logic so it can be tested without HTTP:
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
  /** Start the research queue on its own request (POST /api/v1/queue), reading the answer like any hand-off. */
  startQueue: (base: string, runId: string) => Promise<HandoffResult>;
  /** One slice of queue work in this request, for when the queue couldn't be started on its own. */
  drainHere: (runId: string) => Promise<{ processed: number; remaining: number; reason?: string | null }>;
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
export async function continueChain(step: TickStep, runId: string, origin: string, d: ChainDeps): Promise<HandoffResult> {
  const next = STEPS[STEPS.indexOf(step) + 1];
  const base = selfBaseUrl(origin);
  if (!next) {
    // The research queue runs on its own request. Its answer is read and recorded like every other
    // hand-off (it used to be a bare yes/no: "queue not started", with no reason).
    const r = await d.startQueue(base, runId).catch((e): HandoffResult => ({ ok: false, outcome: "network", status: null, host: "", attempts: 1, ms: 0, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) }));
    logStage({ runId, from: step, to: "queue", state: r.ok ? "handoff_accepted" : "handoff_failed", outcome: r.outcome, status: r.status, host: r.host, attempts: r.attempts, ms: r.ms });
    if (r.ok) return r;
    // Refused (in production: the platform's limit on the app calling itself, at the end of a chain of
    // five such calls): do one slice of the queue here, so the queue never waits a whole day. The
    // queue's lease keeps two workers from taking the same slice.
    let here: string;
    try {
      const s = await d.drainHere(runId);
      here = `ran one slice here instead: ${s.processed} done, ${s.remaining} waiting${s.reason ? ` (${s.reason})` : ""}`;
    } catch (e) {
      here = `the slice here failed too: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
    }
    logStage({ runId, step: "queue", state: "ran_in_place", note: here });
    const note = `→ queue ${r.outcome}${r.status ? ` ${r.status}` : ""} host=${r.host || "none"} attempts=${r.attempts} run=${runId}${r.detail ? `: ${r.detail}` : ""}; ${here}`;
    await d.record("Daily check · handoff", d.now?.() ?? new Date(), { ok: false, note });
    await d.recordError("daily check · handoff", new Error(`Hand-off to the research queue failed: ${r.outcome}${r.status ? ` (${r.status})` : ""}`), note);
    return r;
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
