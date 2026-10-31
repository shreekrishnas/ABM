// Financial health from the fiscal years we hold, by fixed rules (no AI).
//   margin = net profit ÷ revenue (latest year)      growth = revenue change vs the year before
//   declining          growth below −10%
//   loss_making        margin below −2%
//   breakeven          margin between −2% and +2%
//   profitable_growing margin above +2% and growth above +5%
//   profitable         margin above +2%
//   unknown            no revenue, or revenue without profit and no prior year
// Figures from filings or licensed providers are preferred over web figures for the same year.

import { formatAmount } from "./money";

export type HealthLabel = "profitable_growing" | "profitable" | "breakeven" | "loss_making" | "declining" | "unknown";

export const HEALTH_LABEL: Record<HealthLabel, string> = {
  profitable_growing: "Profitable and growing",
  profitable: "Profitable",
  breakeven: "Around breakeven",
  loss_making: "Loss-making",
  declining: "Revenue declining",
  unknown: "Not enough data",
};

/** Design tokens (text colour, background) per label. */
export const HEALTH_TONE: Record<HealthLabel, { fg: string; bg: string }> = {
  profitable_growing: { fg: "var(--success-strong)", bg: "var(--success-bg)" },
  profitable: { fg: "var(--success)", bg: "var(--success-bg)" },
  breakeven: { fg: "var(--warning-strong)", bg: "var(--warning-bg)" },
  loss_making: { fg: "var(--danger-strong)", bg: "var(--danger-bg)" },
  declining: { fg: "var(--danger-strong)", bg: "var(--danger-bg)" },
  unknown: { fg: "var(--neutral)", bg: "var(--neutral-bg)" },
};

export interface YearFigures {
  fiscalYear: string;
  currency: string;
  revenue: number | null;
  netProfit: number | null;
  source: string;
  status: string;
}

const RANK: Record<string, number> = { filing: 3, provider: 2, web: 1 };

/** One row per fiscal year: the most authoritative source wins (filing > provider > verified web > probable web). */
export function bestPerYear(rows: YearFigures[]): YearFigures[] {
  const by = new Map<string, YearFigures>();
  const score = (r: YearFigures) => (RANK[r.source] ?? 0) * 10 + (r.status === "verified" ? 1 : 0);
  for (const r of rows) {
    const cur = by.get(r.fiscalYear);
    if (!cur || score(r) > score(cur)) by.set(r.fiscalYear, r);
  }
  return [...by.values()].sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear));
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

export function financialHealth(rows: YearFigures[]): { label: HealthLabel; note: string; margin: number | null; growth: number | null } {
  const years = bestPerYear(rows).filter((r) => r.revenue != null && r.revenue > 0);
  const latest = years[0];
  if (!latest) return { label: "unknown", note: "No revenue figure found yet", margin: null, growth: null };
  const prevYear = `FY${Number(latest.fiscalYear.slice(2)) - 1}`;
  const prev = years.find((y) => y.fiscalYear === prevYear && y.currency === latest.currency);
  const margin = latest.netProfit != null ? latest.netProfit / latest.revenue! : null;
  const growth = prev?.revenue ? (latest.revenue! - prev.revenue) / prev.revenue : null;
  const parts = [`${latest.fiscalYear} revenue ${formatAmount(latest.revenue, latest.currency)}${growth != null ? ` (${pct(growth)} vs ${prev!.fiscalYear})` : ""}`];
  if (latest.netProfit != null) parts.push(`net ${latest.netProfit >= 0 ? "profit" : "loss"} ${formatAmount(Math.abs(latest.netProfit), latest.currency)} (${pct(margin!).replace("+", "")} margin)`);
  const note = parts.join(", ");
  let label: HealthLabel = "unknown";
  if (growth != null && growth < -0.1) label = "declining";
  else if (margin != null && margin < -0.02) label = "loss_making";
  else if (margin != null && margin <= 0.02) label = "breakeven";
  else if (margin != null && growth != null && growth > 0.05) label = "profitable_growing";
  else if (margin != null) label = "profitable";
  return { label, note, margin, growth };
}
