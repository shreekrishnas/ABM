import { NextResponse } from "next/server";
import { z } from "zod";

// Shared helpers for /api/v1. A bearer token is required when ABM_API_KEY is
// set (it must be set before deploying; see docs/PLAN.md roadmap item 1).
export function authorize(req: Request): NextResponse | null {
  const key = process.env.ABM_API_KEY;
  if (!key) return null;
  if (req.headers.get("authorization") !== `Bearer ${key}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
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
