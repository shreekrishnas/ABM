"use client";

// Company flow: a column per step (count in the bar, step name above), a soft band joining the
// steps, the conversion between each pair (the biggest drop in red), how many stopped at each step
// under its bar, and four summary figures. Click a bar or a "stopped" card to list the companies.
// Tier filter and a table view; every number is also readable without the picture.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, BarChart3, Info, Table2, TrendingDown, Users } from "lucide-react";
import type { FlowAccount } from "@/lib/command-center";

type Sel = { kind: "step" | "exit"; i: number } | null;
/** A step where this share or more of the companies stopped is flagged. */
const HEAVY_STOP = 0.4;

export function FunnelTrack({ steps, accounts }: { steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[] }) {
  const [tier, setTier] = useState("all");
  const [sel, setSel] = useState<Sel>(null);
  const [table, setTable] = useState(false);
  const rows = useMemo(() => (tier === "all" ? accounts : accounts.filter((a) => (a.tier ?? "none") === tier)), [accounts, tier]);
  const n = steps.length;
  const reached = steps.map((_, i) => rows.filter((a) => a.reached >= i));
  // The last step is the goal: companies there have arrived, not stopped.
  const stopped = steps.map((_, i) => (i === steps.length - 1 ? [] : rows.filter((a) => a.reached === i)));
  const count = reached.map((r) => r.length);
  const top = Math.max(1, count[0]);
  const conv = count.map((v, i) => (i && count[i - 1] ? v / count[i - 1] : null));
  let worst = -1;
  conv.forEach((c, i) => { if (c != null && count[i - 1] > 0 && (worst < 0 || c < (conv[worst] ?? 1))) worst = i; });
  const totalStopped = stopped.slice(0, n - 1).reduce((t, s) => t + s.length, 0);
  const inProcess = count[0] - totalStopped;
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 && a ? 1 : 0)}%` : "0%");
  const reasons = (list: FlowAccount[]) => Object.entries(list.reduce<Record<string, number>>((m, a) => ({ ...m, [a.reason]: (m[a.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const list = sel ? (sel.kind === "step" ? reached[sel.i] : stopped[sel.i]) : [];
  const toggle = (s: NonNullable<Sel>) => setSel(sel && sel.kind === s.kind && sel.i === s.i ? null : s);
  // Bar heights: share of the first step, with a floor so small steps stay visible.
  // Square-root scale so later steps stay readable after a big drop; the exact counts are printed.
  const barPct = (v: number) => (v ? 18 + 82 * Math.sqrt(v / top) : 4);
  // Band: an area through the top of each bar (in a 0–100 box per step).
  const band = (() => {
    const pts = count.map((v, i) => ({ x: i * 100 + 50, y: 100 - barPct(v) }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < n; i++) {
      const cx = (pts[i - 1].x + pts[i].x) / 2;
      d += ` C ${cx} ${pts[i - 1].y}, ${cx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
    }
    return `${d} L ${pts[n - 1].x} 100 L ${pts[0].x} 100 Z`;
  })();

  return (
    <div className="cf">
      <header className="cf-head">
        <div className="min-w-0">
          <h2>Company flow <span className="cf-info" title="Each step counts companies that also passed every step before it. LinkedIn counts only what the team logged; nothing is estimated."><Info size={15} aria-label="About this chart" /></span></h2>
          <p>How companies move through the research and sales process</p>
        </div>
        <div className="cf-tools">
          <div className="k-seg cf-seg" role="group" aria-label="Filter by tier">
            {["all", "T1", "T2", "T3"].map((t) => <button key={t} type="button" aria-pressed={tier === t} onClick={() => { setTier(t); setSel(null); }}>{t === "all" ? "All" : t}</button>)}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTable(!table)} aria-pressed={table}><Table2 size={15} /> {table ? "Show as chart" : "Show as table"}</button>
        </div>
      </header>

      {table ? (
        <div className="table-wrap">
          <table className="data compact">
            <thead><tr><th>Step</th><th className="text-right">Reached</th><th className="text-right">From step before</th><th className="text-right">Stopped here</th></tr></thead>
            <tbody>{steps.map((s, i) => <tr key={s.key}><td>{s.label}</td><td className="text-right tnum">{count[i]}</td><td className="text-right tnum">{conv[i] == null ? "—" : pct(count[i], count[i - 1])}</td><td className="text-right tnum">{stopped[i].length} ({pct(stopped[i].length, count[i])})</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="cf-scroll">
          <div className="cf-chart" style={{ ["--n" as string]: n }}>
            <svg className="cf-band" viewBox={`0 0 ${n * 100} 100`} preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="cf-band-g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" className="cf-b1" /><stop offset="100%" className="cf-b2" /></linearGradient>
              </defs>
              <path d={band} fill="url(#cf-band-g)" />
            </svg>
            <ol className="cf-cols">
              {steps.map((s, i) => {
                const v = count[i];
                const share = v / top;
                return (
                  <li key={s.key} className={sel && sel.i !== i ? "dim" : undefined}>
                    <span className="cf-l" style={{ bottom: `calc(${barPct(v)}% + 6px)` }}>{s.label}</span>
                    <button type="button" className={`cf-bar${v ? "" : " zero"}${share < 0.45 ? " light" : ""}${sel?.kind === "step" && sel.i === i ? " on" : ""}`} style={{ height: `${barPct(v)}%`, ["--s" as string]: `${Math.round(35 + share * 65)}%` }} onClick={() => v && toggle({ kind: "step", i })} title={`${s.define} · ${v}`} disabled={!v}>
                      <b className="tnum">{v.toLocaleString()}</b>
                    </button>
                    {i > 0 && (
                      <span className={`cf-conv tnum${i === worst ? " worst" : ""}`} style={{ bottom: `calc(${Math.max(barPct(count[i - 1]), barPct(v))}% + 30px)` }}>
                        {conv[i] == null ? "—" : pct(v, count[i - 1])}
                        <svg viewBox="0 0 24 12" aria-hidden><path d="M2 2 Q 12 12 20 7" /><path d="M17 4 L20 7 L16 9" /></svg>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <ol className="cf-stops" style={{ ["--n" as string]: n }}>
            {steps.map((s, i) => {
              const st = stopped[i].length;
              const share = count[i] ? st / count[i] : 0;
              return (
                <li key={s.key}>
                  <button type="button" className={`cf-stop${share >= HEAVY_STOP && st ? " heavy" : ""}${sel?.kind === "exit" && sel.i === i ? " on" : ""}`} onClick={() => st && toggle({ kind: "exit", i })} disabled={!st} title={st ? `${st} stopped at ${s.label.toLowerCase()}: ${reasons(stopped[i]).map(([k, c]) => `${k} ${c}`).join(", ")}` : undefined}>
                    <b className="tnum">{st.toLocaleString()} stopped</b>
                    <span className="tnum">({pct(st, count[i])})</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {sel && (
        <div className="viz-drill">
          <div className="viz-drill-head">
            <b>{sel.kind === "step" ? `${list.length} reached ${steps[sel.i].label.toLowerCase()}` : `${list.length} stopped at ${steps[sel.i].label.toLowerCase()}`}</b>
            {sel.kind === "exit" && <span className="ld-reasons">{reasons(list).map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}</span>}
            <button type="button" className="viz-chip" onClick={() => setSel(null)}>Clear</button>
          </div>
          <ul>{list.slice(0, 40).map((a) => <li key={a.id}><Link href={`/accounts/${a.id}`}>{a.name}</Link><span className="viz-tag">{a.tier ?? "—"}</span>{sel.kind === "exit" && <span className="viz-reason">{a.reason}</span>}</li>)}</ul>
          {list.length > 40 && <p className="muted text-xs">and {list.length - 40} more</p>}
        </div>
      )}

      <div className="cf-sum">
        <div className="cf-s">
          <span className="cf-ic"><BarChart3 size={18} /></span>
          <span><small>Overall conversion</small><b className="tnum">{pct(count[n - 1], count[0])}</b><em className="tnum">{count[0].toLocaleString()} → {count[n - 1].toLocaleString()}</em></span>
        </div>
        <div className={`cf-s${worst > 0 ? " bad" : ""}`}>
          <span className="cf-ic"><TrendingDown size={18} /></span>
          <span><small>Biggest drop-off</small>{worst > 0 ? <><b className="tnum">{pct(count[worst - 1] - count[worst], count[worst - 1])}</b><em>{steps[worst - 1].label} → {steps[worst].label}</em></> : <b>—</b>}</span>
        </div>
        <div className="cf-s">
          <span className="cf-ic"><Users size={18} /></span>
          <span><small>Total stopped (so far)</small><b className="tnum">{totalStopped.toLocaleString()}</b><em className="tnum">({pct(totalStopped, count[0])})</em></span>
        </div>
        <div className="cf-s">
          <span className="cf-ic"><ArrowRight size={18} /></span>
          <span><small>Currently in process</small><b className="tnum">{inProcess.toLocaleString()}</b><em className="tnum">({pct(inProcess, count[0])})</em></span>
        </div>
      </div>
    </div>
  );
}
