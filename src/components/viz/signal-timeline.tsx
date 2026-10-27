"use client";

// Signal timeline: everything that happened at one company, by kind of signal, on one time
// axis. Shaded spans mark convergence: two or more different kinds of buying signal within
// 30 days, which is what makes intent "hot". Hover for detail, click to open the source.

import { useMemo, useState } from "react";

export interface TimelineItem { lane: string; label: string; at: string; strength: number; href?: string | null; negative?: boolean }
const DAY = 86_400_000;
const RANGES = [{ k: "90", d: 90, l: "90 days" }, { k: "365", d: 365, l: "12 months" }, { k: "all", d: 0, l: "All" }] as const;
const W = 1000, LEFT = 150, RIGHT = 20, ROW = 34, TOP = 28;

export function SignalTimeline({ items, lanes }: { items: TimelineItem[]; lanes: { key: string; label: string }[] }) {
  // Open on the tightest range that still holds every signal.
  const oldest = Math.min(Date.now(), ...items.map((i) => Date.parse(i.at)));
  const [range, setRange] = useState<(typeof RANGES)[number]["k"]>(() => (Date.now() - oldest <= 90 * DAY ? "90" : Date.now() - oldest <= 365 * DAY ? "365" : "all"));
  const [hidden, setHidden] = useState<string[]>([]);
  const [hover, setHover] = useState<{ it: TimelineItem; x: number; y: number } | null>(null);
  const now = Date.now();
  const days = RANGES.find((r) => r.k === range)!.d;
  const shown = useMemo(() => items.filter((i) => !hidden.includes(i.lane) && (!days || Date.parse(i.at) >= now - days * DAY)), [items, hidden, days, now]);
  const lo = days ? now - days * DAY : Math.min(now - 30 * DAY, ...items.map((i) => Date.parse(i.at)));
  const X = (t: number) => LEFT + ((t - lo) / Math.max(DAY, now - lo)) * (W - LEFT - RIGHT);
  const activeLanes = lanes.filter((l) => items.some((i) => i.lane === l.key));
  const Y = (lane: string) => TOP + activeLanes.findIndex((l) => l.key === lane) * ROW + ROW / 2;
  const H = TOP + activeLanes.length * ROW + 26;
  // Convergence: windows where 2+ different positive lanes have a signal within 30 days.
  const spans = useMemo(() => {
    const pos = shown.filter((i) => !i.negative).map((i) => ({ t: Date.parse(i.at), lane: i.lane })).sort((a, b) => a.t - b.t);
    const out: [number, number][] = [];
    for (const p of pos) {
      const win = pos.filter((q) => q.t >= p.t && q.t <= p.t + 30 * DAY);
      if (new Set(win.map((w) => w.lane)).size >= 2) {
        const end = Math.max(...win.map((w) => w.t));
        const last = out.at(-1);
        if (last && p.t <= last[1]) last[1] = Math.max(last[1], end);
        else out.push([p.t, end]);
      }
    }
    return out;
  }, [shown]);
  const months: number[] = [];
  for (let d = new Date(lo); d.getTime() <= now; d.setMonth(d.getMonth() + (days && days <= 90 ? 1 : days ? 2 : 3))) months.push(new Date(d.getFullYear(), d.getMonth(), 1).getTime());

  if (!activeLanes.length) return <p className="muted text-sm">No signals recorded yet. Research facts, website visits, LinkedIn steps and email activity appear here as they happen.</p>;
  return (
    <div className="viz">
      <div className="viz-filters">
        {RANGES.map((r) => <button key={r.k} type="button" className={`viz-chip${range === r.k ? " on" : ""}`} onClick={() => setRange(r.k)}>{r.l}</button>)}
        <span className="viz-hint">Click a row name to hide it · shaded = signals converging</span>
      </div>
      <div className="viz-stage" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signal timeline">
          {spans.map(([a, b], i) => <rect key={i} x={X(a) - 6} y={TOP - 6} width={Math.max(12, X(b) - X(a) + 12)} height={activeLanes.length * ROW + 12} rx="8" className="viz-converge" />)}
          {months.filter((m) => m >= lo).map((m) => (
            <g key={m}><line x1={X(m)} x2={X(m)} y1={TOP - 6} y2={H - 22} className="viz-grid" /><text x={X(m)} y={H - 8} className="viz-tick" textAnchor="middle">{new Date(m).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}</text></g>
          ))}
          {activeLanes.map((l) => {
            const off = hidden.includes(l.key);
            return (
              <g key={l.key}>
                <line x1={LEFT} x2={W - RIGHT} y1={Y(l.key)} y2={Y(l.key)} className="viz-lane" />
                <text x={LEFT - 12} y={Y(l.key) + 4} textAnchor="end" className={`viz-lane-name${off ? " off" : ""}`} onClick={() => setHidden(off ? hidden.filter((h) => h !== l.key) : [...hidden, l.key])}>{l.label}</text>
              </g>
            );
          })}
          <line x1={X(now)} x2={X(now)} y1={TOP - 10} y2={H - 22} className="viz-now" />
          {shown.map((it, i) => {
            const cx = X(Date.parse(it.at)), cy = Y(it.lane), r = 5 + Math.round(Math.max(0, Math.min(1, Math.abs(it.strength))) * 4);
            return (
              <g key={i} className="viz-dot-g" onMouseMove={(e) => setHover({ it, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })} onClick={() => it.href && window.open(it.href, it.href.startsWith("/") ? "_self" : "_blank", "noopener")}>
                <circle cx={cx} cy={cy} r={14} fill="transparent" />
                <circle cx={cx} cy={cy} r={r} className={`viz-dot${it.negative ? " neg" : ""}`} />
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="chart-tip viz-tip" style={{ left: Math.min(hover.x + 14, 700), top: hover.y + 10 }}>
            <div className="muted text-[11px]">{lanes.find((l) => l.key === hover.it.lane)?.label} · {new Date(hover.it.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
            <div className="font-semibold">{hover.it.label}</div>
            {hover.it.href && <div className="muted text-[11px]">Click to open {hover.it.href.startsWith("/") ? "" : "the source"}</div>}
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table className="data compact"><thead><tr><th>Date</th><th>Kind</th><th>What happened</th></tr></thead>
          <tbody>{[...shown].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((it, i) => <tr key={i}><td className="tnum">{it.at.slice(0, 10)}</td><td>{lanes.find((l) => l.key === it.lane)?.label}</td><td>{it.href ? <a href={it.href} target={it.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="underline">{it.label}</a> : it.label}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
