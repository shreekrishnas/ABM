// Fixed-window request counters in the database, so limits hold across all servers.
// Used for sign-in attempts and the public API.

import { baseDb } from "@/lib/db-base";

export interface Limit {
  ok: boolean;
  count: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

/** Count one request for `key`; ok=false once more than `max` arrive within `windowMs`. Fails open on a database error. */
export async function hit(key: string, max: number, windowMs: number, now = new Date()): Promise<Limit> {
  const cutoff = new Date(now.getTime() - windowMs);
  try {
    const rows = await baseDb.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${now}, 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."windowStart" < ${cutoff} THEN 1 ELSE "RateLimit"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimit"."windowStart" < ${cutoff} THEN ${now} ELSE "RateLimit"."windowStart" END
      RETURNING "count", "windowStart"`;
    const r = rows[0];
    const retryAfter = Math.max(1, Math.ceil((r.windowStart.getTime() + windowMs - now.getTime()) / 1000));
    return { ok: r.count <= max, count: r.count, retryAfter };
  } catch {
    // Never lock people out because the counter itself failed.
    return { ok: true, count: 0, retryAfter: 0 };
  }
}

/** The caller's address as seen by the host (first hop of x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

export const LIMITS = {
  /** Sign-in attempts per address and per email. */
  login: { max: 10, windowMs: 15 * 60_000 },
  /** Public API calls per address (tracking script, webhooks, cron). */
  api: { max: 300, windowMs: 60_000 },
};
