import { db } from "@/lib/db";
import type { PriorityParts } from "@/lib/brain/priority";

// Companies in priority order, as CSV (behind the same page password as the app).
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const accounts = await db.account.findMany({
    where: { mergedIntoId: null },
    orderBy: [{ priorityScore: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    select: { name: true, domain: true, industry: true, employees: true, country: true, tier: true, stage: true, priorityScore: true, priorityParts: true, fitScore: true, intentReading: true, disqualifyReason: true },
  });
  const head = ["Company", "Website", "Industry", "Employees", "Country", "Tier", "Stage", "Priority", "Intent", "Fit", "Value", "Timing", "Intent level", "Why now", "Excluded because"];
  const rows = accounts.map((a) => {
    const p = a.priorityParts as unknown as PriorityParts | null;
    const r = a.intentReading as { level?: string; whyNow?: string | null } | null;
    return [a.name, a.domain, a.industry, a.employees, a.country, a.tier, a.stage, a.priorityScore, p?.intent, p?.fit ?? a.fitScore, p?.value, p?.timing, r?.level, r?.whyNow, a.disqualifyReason].map(cell).join(",");
  });
  return new Response([head.join(","), ...rows].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="companies-by-priority-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
