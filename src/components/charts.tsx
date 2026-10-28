"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-seq", "--chart-area", "--text-muted", "--grid-line", "--surface-card-elevated", "--text-primary"] as const;
type Tokens = Record<(typeof TOKENS)[number], string>;

/** Resolve CSS tokens to concrete colours and re-resolve when the theme flips. */
function useTokens(): Tokens | null {
  const [t, setT] = useState<Tokens | null>(null);
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      setT(Object.fromEntries(TOKENS.map((k) => [k, cs.getPropertyValue(k).trim()])) as Tokens);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return t;
}

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number; name?: string; payload?: Record<string, unknown> }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="muted mb-0.5 text-[11px]">{label ?? String(payload[0].payload?.label ?? "")}</div>
      <div className="font-semibold tnum">{payload[0].value.toLocaleString()}{unit ? ` ${payload[0].value === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit}` : ""}</div>
    </div>
  );
}

const axis = (t: Tokens) => ({ fontSize: 12, fill: t["--text-muted"] });

/** Money is shown as money; everything else as a count. */
const fmt = (v: number, unit?: string) => (unit === "USD" ? `$${v.toFixed(v < 10 ? 2 : 0)}` : v.toLocaleString());

/** The axis runs to the data, not past it: 0 → max × 1.1 (a $0.78 maximum never gets a 0–4 axis). */
function scale(data: { value: number }[]) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return { domain: [0, max ? max * 1.1 : 1] as [number, number], decimals: max < 5 };
}

/** No data: say so at the chart's height, instead of drawing empty axes. */
function ChartEmpty({ height, text }: { height: number; text: string }) {
  return <div className="chart-empty" style={{ minHeight: Math.min(height, 160) }}><p>{text}</p></div>;
}

/** Fewer than three values read better as numbers than as a chart. */
function FewValues({ data, unit }: { data: { label: string; value: number }[]; unit?: string }) {
  return (
    <ul className="chart-few">
      {data.map((d) => <li key={d.label}><span>{d.label}</span><b className="tnum">{fmt(d.value, unit)}</b></li>)}
    </ul>
  );
}

/** Every chart has a table twin: values stay readable without hover or colour. */
function TableView({ data, unit, label = "Item" }: { data: { label: string; value: number }[]; unit?: string; label?: string }) {
  return (
    <details className="chart-table">
      <summary>Show as table</summary>
      <table className="data compact">
        <thead><tr><th>{label}</th><th className="text-right">{unit ? unit[0].toUpperCase() + unit.slice(1) : "Value"}</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td className="text-right tnum">{fmt(d.value, unit)}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

/** Horizontal bars, one series (buying-stage funnel, gate blocks). */
export function HBars({ data, unit, height = 260, empty = "Nothing to show yet." }: { data: { label: string; value: number }[]; unit?: string; height?: number; empty?: string }) {
  const t = useTokens();
  const nonZero = data.filter((d) => d.value > 0);
  if (!nonZero.length) return <ChartEmpty height={height} text={empty} />;
  if (nonZero.length < 3) return <><FewValues data={data.filter((d) => d.value > 0)} unit={unit} /><TableView data={data} unit={unit} /></>;
  if (!t) return <div style={{ height }} />;
  const sc = scale(data);
  return (
    <div className="chart">
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={t["--grid-line"]} />
        <XAxis type="number" tick={axis(t)} axisLine={false} tickLine={false} allowDecimals={sc.decimals} domain={sc.domain} tickFormatter={(v: number) => fmt(v, unit)} />
        <YAxis type="category" dataKey="label" tick={axis(t)} axisLine={false} tickLine={false} width={96} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "rgba(124, 58, 237, 0.06)", radius: 6 }} />
        <Bar dataKey="value" fill={t["--chart-seq"]} radius={[0, 4, 4, 0]} maxBarSize={16} background={{ fill: "transparent" }} label={{ position: "right", fontSize: 12, fill: t["--text-primary"], formatter: (v: unknown) => fmt(Number(v), unit) }} />
      </BarChart>
    </ResponsiveContainer>
    <TableView data={data} unit={unit} />
    </div>
  );
}

/** Vertical bars, one series. */
export function VBars({ data, unit, height = 220, empty = "Nothing to show yet." }: { data: { label: string; value: number }[]; unit?: string; height?: number; empty?: string }) {
  const t = useTokens();
  if (!data.some((d) => d.value > 0)) return <ChartEmpty height={height} text={empty} />;
  if (!t) return <div style={{ height }} />;
  const sc = scale(data);
  return (
    <div className="chart">
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={t["--grid-line"]} />
        <XAxis dataKey="label" tick={axis(t)} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={axis(t)} axisLine={false} tickLine={false} allowDecimals={sc.decimals} domain={sc.domain} tickFormatter={(v: number) => fmt(v, unit)} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "rgba(124, 58, 237, 0.06)", radius: 6 }} />
        <Bar dataKey="value" fill={t["--chart-seq"]} radius={[4, 4, 0, 0]} maxBarSize={24} background={{ fill: "transparent" }} />
      </BarChart>
    </ResponsiveContainer>
    <TableView data={data} unit={unit} />
    </div>
  );
}

/**
 * Daily values over time as bars, one per day, no smoothing: sparse events are shown as they
 * happened (a smoothed line would draw a hump across days with nothing in them).
 */
export function AreaTrend({ data, unit, height = 220, empty = "Nothing recorded in this period yet." }: { data: { label: string; value: number }[]; unit?: string; height?: number; empty?: string }) {
  const t = useTokens();
  if (!data.some((d) => d.value > 0)) return <ChartEmpty height={height} text={empty} />;
  if (!t) return <div style={{ height }} />;
  const sc = scale(data);
  return (
    <div className="chart">
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="12%">
        <CartesianGrid vertical={false} stroke={t["--grid-line"]} />
        <XAxis dataKey="label" tick={axis(t)} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={axis(t)} axisLine={false} tickLine={false} allowDecimals={sc.decimals} domain={sc.domain} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "rgba(124, 58, 237, 0.06)" }} />
        <Bar dataKey="value" fill={t["--chart-area"]} radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
    <TableView data={data.filter((d) => d.value > 0)} unit={unit} label="Day" />
    </div>
  );
}

/** Tier distribution donut; legend + values are always shown, so identity never relies on colour alone. */
export function TierDonut({ data }: { data: { label: string; value: number }[] }) {
  const t = useTokens();
  if (!t) return <div style={{ height: 180 }} />;
  const colors = [t["--chart-1"], t["--chart-2"], t["--chart-3"]];
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} outerRadius={70} paddingAngle={2} stroke={t["--surface-card-elevated"]} strokeWidth={2}>
              {data.map((_, i) => <Cell key={i} fill={colors[i % 3]} />)}
            </Pie>
            <Tooltip content={<Tip unit="accounts" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="display-num text-2xl tnum">{total}</div>
            <div className="micro">tiered</div>
          </div>
        </div>
      </div>
      <ul className="grid flex-1 gap-2 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 secondary"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i % 3] }} />{d.label}</span>
            <span className="font-semibold tnum" style={{ color: "var(--text-primary)" }}>{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
