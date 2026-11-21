// How one step of the daily check starts the next: where the request goes, which headers it
// carries, how the answer is read, and what gets recorded. Each step of the chain is its own
// request to this app, so a failed hand-off used to stop every later step without a trace.
//
// - Destination: APP_URL, else Vercel's stable production address, else the request's own
//   origin. Never a per-deployment address when either setting exists: those sit behind
//   Vercel's deployment protection and answer with a sign-in page.
// - Auth: the same bearer secret the queue uses (ABM_API_KEY, else CRON_SECRET). When Vercel's
//   "Protection Bypass for Automation" is on, its secret goes in x-vercel-protection-bypass.
// - Retries: once, only when the request clearly never started the step (a network error, or
//   502/503/504 from the platform). Never after a timeout or an auth refusal. A step that runs
//   twice anyway is skipped by its per-day lease (see claimStep), so nothing is done twice.

import { randomUUID } from "node:crypto";

export const RUN_HEADER = "x-abm-run-id";
export const BYPASS_HEADER = "x-vercel-protection-bypass";

const env = (k: string) => process.env[k]?.trim() || undefined;

/**
 * The address the app uses to call itself.
 * - prefer "production" (the scheduled chain): APP_URL, else Vercel's production address, else origin.
 *   The scheduler's own origin may be a protected per-deployment address.
 * - prefer "origin" (calls started from a person's request): APP_URL, else the address they are
 *   browsing on, which is known to be reachable. Unchanged from before.
 */
export function selfBaseUrl(origin?: string | null, prefer: "production" | "origin" = "production"): string {
  const app = env("APP_URL");
  if (app) return app.replace(/\/$/, "");
  if (prefer === "origin" && origin) return origin.replace(/\/$/, "");
  // Vercel sets this on every deployment; use it only on production, so a preview never calls production.
  const prod = env("VERCEL_ENV") === "production" ? env("VERCEL_PROJECT_PRODUCTION_URL") : undefined;
  if (prod) return (/^https?:\/\//.test(prod) ? prod : `https://${prod}`).replace(/\/$/, "");
  return (origin ?? "").replace(/\/$/, "");
}

/** The secret the app uses to call its own routes. */
export function selfToken(): string {
  return env("ABM_API_KEY") || env("CRON_SECRET") || "";
}

/** Headers for a call to this app: bearer secret, Vercel bypass (when configured), run id. */
export function selfHeaders(runId?: string): Record<string, string> {
  const h: Record<string, string> = {};
  const token = selfToken();
  if (token) h.authorization = `Bearer ${token}`;
  const bypass = env("VERCEL_AUTOMATION_BYPASS_SECRET");
  if (bypass) h[BYPASS_HEADER] = bypass;
  if (runId) h[RUN_HEADER] = runId;
  return h;
}

/** A short id that ties every record of one day's run together. */
export function newRunId(): string {
  return `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Accept only a safe-looking run id from a request; otherwise start a new one. */
export function runIdFrom(req: Request): string {
  const v = req.headers.get(RUN_HEADER) ?? new URL(req.url).searchParams.get("run") ?? "";
  return /^run_[a-z0-9]{6,32}$/i.test(v) ? v : newRunId();
}

export type HandoffOutcome =
  | "accepted" // 2xx: the next step answered
  | "protected" // 401/403 page from Vercel deployment protection (not our API)
  | "unauthorized" // 401/403 from our API: wrong or missing secret
  | "not_configured" // 503 api_key_not_configured from our API
  | "server_error" // other 5xx
  | "client_error" // other 4xx
  | "timeout"
  | "network";

export interface HandoffResult {
  ok: boolean;
  outcome: HandoffOutcome;
  status: number | null;
  host: string;
  attempts: number;
  ms: number;
  detail?: string;
}

/** Read a response into an outcome. Protection pages are HTML or carry Vercel's own markers. */
export async function classifyResponse(res: Response): Promise<{ outcome: HandoffOutcome; detail?: string }> {
  if (res.ok) return { outcome: "accepted" };
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    const vercel = !type.includes("json") || /vercel|authentication required|_vercel_sso/i.test(body) || res.headers.has("x-vercel-error");
    return vercel ? { outcome: "protected", detail: "Vercel deployment protection answered instead of the app" } : { outcome: "unauthorized", detail: "The app refused the secret" };
  }
  if (res.status === 503 && /api_key_not_configured/.test(body)) return { outcome: "not_configured", detail: "No ABM_API_KEY or CRON_SECRET in production" };
  if (res.status >= 500) return { outcome: "server_error", detail: body.slice(0, 160) };
  return { outcome: "client_error", detail: body.slice(0, 160) };
}

/** Only these clearly mean "the step never started", so one retry can't run it twice. */
export function retryable(r: { outcome: HandoffOutcome; status: number | null }): boolean {
  return r.outcome === "network" || (r.outcome === "server_error" && (r.status === 502 || r.status === 503 || r.status === 504));
}

export interface HandoffOptions {
  url: string;
  runId: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/** POST to the next step and report exactly what happened. Never throws. */
export async function handOff(o: HandoffOptions): Promise<HandoffResult> {
  const doFetch = o.fetchImpl ?? fetch;
  let host = "";
  try {
    host = new URL(o.url).host;
  } catch {
    return { ok: false, outcome: "client_error", status: null, host: "", attempts: 0, ms: 0, detail: "No address to call (set APP_URL)" };
  }
  const started = Date.now();
  let attempts = 0;
  let last: HandoffResult | null = null;
  while (attempts < 2) {
    attempts++;
    try {
      const res = await doFetch(o.url, { method: "POST", headers: selfHeaders(o.runId), signal: AbortSignal.timeout(o.timeoutMs ?? 15_000), cache: "no-store" });
      const c = await classifyResponse(res);
      last = { ok: c.outcome === "accepted", outcome: c.outcome, status: res.status, host, attempts, ms: Date.now() - started, detail: c.detail };
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      const timeout = name === "TimeoutError" || name === "AbortError";
      last = { ok: false, outcome: timeout ? "timeout" : "network", status: null, host, attempts, ms: Date.now() - started, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) };
    }
    if (last.ok || !retryable(last) || attempts >= 2) break;
    await new Promise((r) => setTimeout(r, o.retryDelayMs ?? 5_000));
  }
  return last!;
}

/** One structured line per pipeline event, easy to find in Vercel logs ("abm.pipeline"). */
export function logStage(event: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ tag: "abm.pipeline", at: new Date().toISOString(), ...event }));
  } catch {
    // never let logging break the pipeline
  }
}

/** Per-day lease name for one step. */
export function stepLeaseName(step: string, now = new Date()) {
  return `tick:${step}:${now.toISOString().slice(0, 10)}`;
}
