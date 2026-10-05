import { NextResponse } from "next/server";
import { seedDemo } from "@/lib/seed";

// One-off demo seeding for hosted environments. Destructive: wipes all data.
// Requires ABM_API_KEY to be configured AND ALLOW_SEED=true.
export const maxDuration = 300;

export async function POST(req: Request) {
  const key = process.env.ABM_API_KEY;
  if (!key || process.env.ALLOW_SEED !== "true") return NextResponse.json({ error: "seeding disabled" }, { status: 403 });
  if (req.headers.get("authorization") !== `Bearer ${key}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const lines: string[] = [];
  const counts = await seedDemo((...a) => lines.push(a.map(String).join(" ")));
  return NextResponse.json({ ok: true, counts, log: lines });
}
