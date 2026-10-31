// Small fetch helper for external APIs: timeout, retries with growing waits on 429/5xx and
// network errors (honouring Retry-After), a short pause for a service that keeps failing, and
// error messages that never include the API key.

export class ApiError extends Error {
  constructor(public service: string, public status: number, message: string) {
    super(`${service} ${status}: ${message}`);
  }
}

/** Attempts per call, and the wait before each retry (ms). */
export const RETRY_WAITS = [1000, 3000];
/** After this many failed calls in a row, a service is paused for PAUSE_MS so runs move on quickly. */
export const BREAKER_AFTER = 5;
export const PAUSE_MS = 2 * 60_000;

const breaker = new Map<string, { fails: number; pausedUntil: number }>();

/** Test hook. */
export function resetBreakers() {
  breaker.clear();
}

function note(service: string, ok: boolean, now = Date.now()) {
  const b = breaker.get(service) ?? { fails: 0, pausedUntil: 0 };
  if (ok) b.fails = 0;
  else if (++b.fails >= BREAKER_AFTER) {
    b.pausedUntil = now + PAUSE_MS;
    b.fails = 0;
  }
  breaker.set(service, b);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(service: string, url: string, init: RequestInit & { timeoutMs?: number; waits?: number[] } = {}): Promise<T> {
  const { timeoutMs = 25_000, waits = RETRY_WAITS, ...rest } = init;
  const paused = breaker.get(service)?.pausedUntil ?? 0;
  // Another engine (or the next run) takes over instead of waiting on a service that is down.
  if (paused > Date.now()) throw new ApiError(service, 503, `paused after repeated failures; retrying after ${new Date(paused).toISOString().slice(11, 16)} UTC`);
  const attempts = waits.length + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (attempt === attempts) {
        note(service, false);
        throw new ApiError(service, 0, e instanceof Error ? e.message : "network error");
      }
      await sleep(waits[attempt - 1]);
      continue;
    }
    if (res.ok) {
      note(service, true);
      return (await res.json()) as T;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === attempts) {
      if (retryable) note(service, false);
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new ApiError(service, res.status, body || res.statusText);
    }
    // Rate limited: wait what the service asks for (capped), else the next step of the backoff.
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : waits[attempt - 1]);
  }
  throw new ApiError(service, 0, "unreachable");
}

/** Parse "2 days ago", "Oct 1, 2026", ISO strings. Returns null if unknown. */
export function parseLooseDate(input: string | null | undefined, now = new Date()): Date | null {
  if (!input) return null;
  const s = input.trim();
  const rel = s.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (rel) {
    const n = Number(rel[1]);
    const ms = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 }[rel[2].toLowerCase() as "day"];
    return new Date(now.getTime() - n * ms);
  }
  if (/^yesterday$/i.test(s)) return new Date(now.getTime() - 86400e3);
  // SerpAPI news: "10/01/2026, 07:00 AM, +0000 UTC"
  const serp = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)?,\s*\+0000 UTC$/i);
  if (serp) {
    const [, mo, da, yr, hh, mi, ap] = serp;
    const h = ap ? (Number(hh) % 12) + (ap.toUpperCase() === "PM" ? 12 : 0) : Number(hh);
    return new Date(Date.UTC(Number(yr), Number(mo) - 1, Number(da), h, Number(mi)));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
