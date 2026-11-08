// Dashboard pieces in one visual language: tinted KPI tiles with a change arrow, grouped bars,
// a donut with legend, sparkline stat cards and mini-metric cards. Pure SVG, server-rendered;
// hovering a bar or slice shows its value (native tooltip). Colours come from the theme tokens.

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";

// Indigo, green, amber first (clearly different side by side), then violet, blue, red.
const SERIES = ["var(--chart-1)", "var(--chart-4)", "var(--chart-3)", "var(--chart-5)", "var(--chart-2)", "var(--chart-6)"];
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-IN") : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** % change from `before` to `now`; null when there is nothing to compare. */
export function change(now: number, before: number): number | null {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

function Delta({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct === null) return <span className="vz-delta new">new</span>;
  const up = pct >= 0;
  const good = pct === 0 ? null : up === goodWhenUp;
  return (
    <span className={`vz-delta ${good === null ? "flat" : good ? "good" : "bad"}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(pct)}%
    </span>
  );
}

/** A headline number on a soft tinted card: label, period, value, change vs the previous period. */
export function KpiTile({ label, value, period, pct, goodWhenUp, note, tint = 0, href }: { label: string; value: ReactNode; period?: string; pct?: number | null; goodWhenUp?: boolean; note?: string; tint?: number; href?: string }) {
  const body = (
    <>
      <span className="vz-kpi-top"><span className="vz-kpi-l">{label}</span>{period && <span className="vz-kpi-p">{period}</span>}</span>
      <span className="vz-kpi-v tnum">{value}</span>
      <span className="vz-kpi-b">{pct !== undefined && <Delta pct={pct} goodWhenUp={goodWhenUp} />}{note && <span className="vz-kpi-n">{note}</span>}</span>
    </>
  );
  const cls = `vz-kpi t${tint % 4}`;
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="vz-kpis">{children}</div>;
}

/** Grouped vertical bars: one group per category, one bar per series, light grid and axis. */
export function GroupedBars({ categories, series, height = 220, empty = "No data yet" }: { categories: string[]; series: { name: string; values: number[] }[]; height?: number; empty?: string }) {
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  if (!max) return <p className="vz-empty">{empty}</p>;
  const W = 600, H = height, padL = 34, padB = 26, padT = 10;
  const whole = series.every((x) => x.values.every((v) => Number.isInteger(v)));
  const step = whole ? Math.max(1, niceStep(max)) : niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotH = H - padB - padT, plotW = W - padL - 8;
  const gw = plotW / categories.length, bw = Math.min(18, (gw * 0.7) / series.length);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  return (
    <div className="vz-chart">
      <div className="vz-legend">{series.map((s, i) => <span key={s.name}><i style={{ background: SERIES[i] }} />{s.name}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => `${s.name}: ${s.values.join(", ")}`).join("; ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="vz-grid" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="vz-axis">{fmt(t)}</text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const gx = padL + ci * gw + (gw - bw * series.length - 4 * (series.length - 1)) / 2;
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[ci] ?? 0;
                const h = Math.max(v ? 2 : 0, (v / top) * plotH);
                return <rect key={s.name} x={gx + si * (bw + 4)} y={padT + plotH - h} width={bw} height={h} rx={4} fill={SERIES[si]}><title>{`${c} · ${s.name}: ${fmt(v)}`}</title></rect>;
              })}
              <text x={padL + ci * gw + gw / 2} y={H - 8} textAnchor="middle" className="vz-axis">{c}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10;
}

/** Donut with the largest share called out in the middle and a legend underneath. */
export function Donut({ data, center, empty = "No data yet", size = 180 }: { data: { label: string; value: number }[]; center?: string; empty?: string; size?: number }) {
  const rows = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((t, d) => t + d.value, 0);
  if (!total) return <p className="vz-empty">{empty}</p>;
  const r = 70, c = 2 * Math.PI * r;
  let off = 0;
  const top = rows[0];
  return (
    <div className="vz-donut">
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={rows.map((d) => `${d.label}: ${d.value}`).join(", ")}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--subtle)" strokeWidth="26" />
        {rows.map((d, i) => {
          const len = (d.value / total) * c;
          const el = <circle key={d.label} cx="100" cy="100" r={r} fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth="26" strokeDasharray={`${Math.max(len - 2, 0.5)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 100 100)"><title>{`${d.label}: ${fmt(d.value)} (${Math.round((d.value / total) * 100)}%)`}</title></circle>;
          off += len;
          return el;
        })}
        <text x="100" y="96" textAnchor="middle" className="vz-donut-v">{Math.round((top.value / total) * 100)}%</text>
        <text x="100" y="116" textAnchor="middle" className="vz-donut-l">{center ?? top.label}</text>
      </svg>
      <ul className="vz-legend col">
        {rows.slice(0, 6).map((d, i) => <li key={d.label}><i style={{ background: SERIES[i % SERIES.length] }} /><span>{d.label}</span><b className="tnum">{fmt(d.value)}</b></li>)}
      </ul>
    </div>
  );
}

/** A small stat card with a sparkline and a link to the details. */
export function SparkStat({ label, value, sub, points, href, tone = "up" }: { label: string; value: ReactNode; sub?: string; points: number[]; href?: string; tone?: "up" | "down" | "flat" }) {
  const W = 110, H = 36, max = Math.max(1, ...points), min = Math.min(0, ...points);
  const xs = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * (W - 4) + 2 : W / 2);
  const ys = (v: number) => H - 4 - ((v - min) / (max - min || 1)) * (H - 8);
  const d = points.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  return (
    <div className="vz-spark">
      <span className="vz-kpi-l">{label}</span>
      <span className="vz-spark-row">
        <span className="vz-spark-v tnum">{value}</span>
        {points.length > 1 && points.every((v) => v === 0) ? <span className="vz-spark-empty">None this week</span> : points.length > 1 && <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className={`vz-spark-line ${tone}`}><path d={d} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <span className="vz-spark-f">{sub && <span className="vz-kpi-n">{sub}</span>}{href && <Link href={href} className="vz-link">View details <ChevronRight size={13} /></Link>}</span>
    </div>
  );
}

/** A card with two or three small figures and an optional change (e.g. sent / opened / replied). */
export function MiniMetrics({ title, period, metrics, pct, href }: { title: string; period?: string; metrics: { label: string; value: ReactNode }[]; pct?: number | null; href?: string }) {
  return (
    <div className="vz-mini">
      <span className="vz-kpi-top"><span className="vz-mini-t">{title}</span>{period && <span className="vz-kpi-p">{period}</span>}</span>
      <span className="vz-mini-row">
        {metrics.map((m) => <span key={m.label}><small>{m.label}</small><b className="tnum">{m.value}</b></span>)}
        {pct !== undefined && <Delta pct={pct} />}
      </span>
      {href && <Link href={href} className="vz-link">View details <ChevronRight size={13} /></Link>}
    </div>
  );
}

/** Daily counts for the last `days` days (oldest first) from a list of dates. */
export function daily(dates: Date[], days = 7, now = new Date()): number[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const out = Array.from({ length: days }, () => 0);
  for (const d of dates) {
    const i = Math.floor((d.getTime() - start) / 86_400_000);
    if (i >= 0 && i < days) out[i]++;
  }
  return out;
}

/** Short weekday labels for the last `days` days (oldest first). */
export function dayLabels(days = 7, now = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i)).toLocaleDateString("en-GB", { weekday: "short" }));
}
