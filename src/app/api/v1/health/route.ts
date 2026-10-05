import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Public liveness check for uptime monitors. Reports only whether the database
// answers — never data, never connection details.
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const accounts = await db.account.count();
    return NextResponse.json({ ok: true, db: "connected", seeded: accounts > 0, ms: Date.now() - started });
  } catch (e) {
    const code = (e as { errorCode?: string; code?: string }).errorCode ?? (e as { code?: string }).code ?? "unknown";
    return NextResponse.json({ ok: false, db: "error", code }, { status: 503 });
  }
}
