import { NextResponse } from "next/server";
import { z } from "zod";

// Shared helpers for /api/v1. A bearer token is required when ABM_API_KEY is set.
// In production the API fails closed: with no key configured every protected route
// answers 503, because these routes spend money (search, LLM) and change data.
// ABM_API_OPEN=true is an explicit, visible opt-out for a private test deployment.

const env = (name: string) => process.env[name]?.trim() || undefined;

/** True when the API may run without a key (local dev, tests, or an explicit opt-out). */
export function apiMayBeOpen() {
  return process.env.NODE_ENV !== "production" || env("ABM_API_OPEN") === "true";
}

/** Constant-time string comparison, so a wrong key can't be guessed byte by byte from response times. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const bearer = (req: Request) => {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
};

export function notConfigured() {
  return NextResponse.json({ error: "api_key_not_configured", message: "Set ABM_API_KEY (and CRON_SECRET for the scheduler) before using the API in production." }, { status: 503 });
}

/** Checks the bearer token against ABM_API_KEY, plus any extra accepted secrets (e.g. CRON_SECRET). */
export function authorize(req: Request, opts: { alsoAccept?: (string | undefined)[] } = {}): NextResponse | null {
  const keys = [env("ABM_API_KEY"), ...(opts.alsoAccept ?? [])].filter((k): k is string => Boolean(k));
  if (keys.length === 0) return apiMayBeOpen() ? null : notConfigured();
  const token = bearer(req);
  if (token && keys.some((k) => safeEqual(token, k))) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** What the Settings page shows about access control and spend caps. */
export function securityStatus() {
  return {
    pagePassword: Boolean(env("APP_PASSWORD")),
    apiKey: Boolean(env("ABM_API_KEY")),
    cronSecret: Boolean(env("CRON_SECRET")),
    apiOpen: !env("ABM_API_KEY") && apiMayBeOpen(),
    production: process.env.NODE_ENV === "production",
    budgetsEnforced: process.env.ENFORCE_BUDGETS === "true",
    seedAllowed: process.env.ALLOW_SEED === "true",
  };
}

export async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
  }
  const p = schema.safeParse(json);
  if (!p.success) return { error: NextResponse.json({ error: "validation_failed", issues: p.error.issues }, { status: 422 }) };
  return { data: p.data };
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

// BigInt (revenueUsd) is not JSON-serialisable by default.
export function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x)));
}
