import { NextResponse } from "next/server";
import { getMe } from "@/lib/me";
import { jobsFor } from "@/lib/jobs";

// The signed-in person's background jobs from the last day, for the top-bar indicator.
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ jobs: [] }, { status: 401 });
  return NextResponse.json({ jobs: await jobsFor(me.email) }, { headers: { "cache-control": "no-store" } });
}
