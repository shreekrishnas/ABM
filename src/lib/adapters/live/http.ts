// Small fetch helper for external APIs: timeout, one retry on 429/5xx, and
// error messages that never include the API key.

export class ApiError extends Error {
  constructor(public service: string, public status: number, message: string) {
    super(`${service} ${status}: ${message}`);
  }
}

export async function fetchJson<T>(service: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 25_000, ...rest } = init;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (attempt === 2) throw new ApiError(service, 0, e instanceof Error ? e.message : "network error");
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new ApiError(service, res.status, body || res.statusText);
    }
    await new Promise((r) => setTimeout(r, 1500));
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
