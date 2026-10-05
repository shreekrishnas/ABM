import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

// Public liveness check for uptime monitors. Reports only whether the database
// answers — never data, never connection details.
export const dynamic = "force-dynamic";

/** Supabase regions have two pooler clusters (aws-0 / aws-1); report whether the other one answers. */
async function probeAlternatePooler(): Promise<boolean | null> {
  const url = process.env.DATABASE_URL ?? "";
  const m = url.match(/@aws-(\d)-/);
  if (!m) return null;
  const alt = url.replace(`@aws-${m[1]}-`, `@aws-${m[1] === "0" ? "1" : "0"}-`);
  const client = new PrismaClient({ datasourceUrl: alt });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

export async function GET() {
  const started = Date.now();
  try {
    const accounts = await db.account.count();
    return NextResponse.json({ ok: true, db: "connected", seeded: accounts > 0, ms: Date.now() - started });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const tenantNotFound = /tenant\/user .* not found/i.test(message);
    return NextResponse.json(
      { ok: false, db: "error", reason: tenantNotFound ? "pooler_tenant_not_found" : "connection_failed", alternatePoolerWorks: tenantNotFound ? await probeAlternatePooler() : null },
      { status: 503 },
    );
  }
}
