import { db } from "@/lib/db";
import { accountWhere } from "@/lib/accounts/filters";
import type { PriorityParts } from "@/lib/brain/priority";

// Companies in priority order, as CSV (behind the same page password as the app).
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const sp = Object.fromEntries(params.entries());
  // Exactly the companies on screen (same filters), or the ticked ones.
  const ids = params.getAll("ids");
  const where = ids.length ? { id: { in: ids.slice(0, 10_000) }, mergedIntoId: null } : accountWhere(sp);
  const accounts = await db.account.findMany({
    where, take: 10_000,
    orderBy: [{ priorityScore: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    select: { name: true, owner: { select: { name: true } }, domain: true, industry: true, employees: true, country: true, tier: true, stage: true, priorityScore: true, priorityParts: true, fitScore: true, intentReading: true, disqualifyReason: true },
  });
  const head = ["Company", "Website", "Owner", "Industry", "Employees", "Country", "Priority group", "Status", "Priority", "Intent", "Fit", "Value", "Timing", "Intent level", "Why now", "Excluded because"];
  const rows = accounts.map((a) => {
    const p = a.priorityParts as unknown as PriorityParts | null;
    const r = a.intentReading as { level?: string; whyNow?: string | null } | null;
    return [a.name, a.domain, a.owner?.name, a.industry, a.employees, a.country, a.tier === "T1" ? "Top" : a.tier === "T2" ? "Mid" : a.tier === "T3" ? "Broad" : "", a.stage, a.priorityScore, p?.intent, p?.fit ?? a.fitScore, p?.value, p?.timing, r?.level, r?.whyNow, a.disqualifyReason].map(cell).join(",");
  });
  return new Response([head.join(","), ...rows].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="companies-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
