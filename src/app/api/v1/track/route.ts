import { NextResponse } from "next/server";
import { z } from "zod";
import { recordVisit } from "@/lib/web/visits";

// Public endpoint for the tracking script on the seller's website. No API key (it runs in
// visitors' browsers), so it only accepts origins listed in TRACK_ORIGINS and only records
// page views — it can't read anything back.
const Body = z.object({
  url: z.string().url().max(500),
  title: z.string().max(200).optional(),
  referrer: z.string().max(300).optional(),
  visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  token: z.string().max(120).optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
});

function allowed(origin: string | null): string | null {
  const list = (process.env.TRACK_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (!list.length) return process.env.NODE_ENV === "production" ? null : origin ?? "*";
  return origin && list.includes(origin) ? origin : null;
}

const cors = (origin: string) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" });

export function OPTIONS(req: Request) {
  const origin = allowed(req.headers.get("origin"));
  return origin ? new NextResponse(null, { status: 204, headers: cors(origin) }) : new NextResponse(null, { status: 403 });
}

export async function POST(req: Request) {
  const origin = allowed(req.headers.get("origin"));
  if (!origin) return NextResponse.json({ error: "origin_not_allowed", hint: "Add your website to TRACK_ORIGINS" }, { status: 403 });
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()); // sendBeacon posts text/plain
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: cors(origin) });
  }
  const b = Body.safeParse(raw);
  if (!b.success) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: cors(origin) });
  // Only pages on the allowed site are recorded.
  if (origin !== "*" && !b.data.url.startsWith(origin)) return NextResponse.json({ error: "url_not_on_site" }, { status: 400, headers: cors(origin) });
  await recordVisit({ ...b.data, source: b.data.token ? "email_link" : "tracking_script" });
  return new NextResponse(null, { status: 204, headers: cors(origin) });
}
