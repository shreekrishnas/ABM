"use client";

// Funnel track: a compact row of steps. Each step is a glass bubble whose area is the number
// of companies that reached it (deeper violet towards revenue); the line between carries the
// conversion, the biggest drop in red. A small badge shows how many stopped there. Click a
// bubble or its badge to list the companies; tier chips re-filter.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FlowAccount } from "@/lib/command-center";

type Sel = { kind: "step" | "exit"; i: number } | null;
const RAMP = ["#C4B5FD", "#B39DFB", "#A78BFA", "#9576F7", "#8B5CF6", "#7C3AED", "#6D28D9", "#5B21B6"];
const MAXD = 50, MIND = 26;

export function FunnelTrack({ steps, accounts }: { steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[] }) {
  const [tier, setTier] = useState("all");
  const [sel, setSel] = useState<Sel>(null);
  const rows = useMemo(() => (tier === "all" ? accounts : accounts.filter((a) => (a.tier ?? "none") === tier)), [accounts, tier]);
  const n = steps.length;
  const reached = steps.map((_, i) => rows.filter((a) => a.reached >= i));
  const stopped = steps.map((_, i) => rows.filter((a) => a.reached === i));
  const top = Math.max(1, reached[0].length);
  // Area encodes the count: diameter grows with the square root.
  const dia = (v: number) => (v ? Math.max(MIND, Math.sqrt(v / top) * MAXD) : MIND);
  const reasons = (list: FlowAccount[]) => Object.entries(list.reduce<Record<string, number>>((m, a) => ({ ...m, [a.reason]: (m[a.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const drops = steps.map((_, i) => (i && reached[i - 1].length ? 1 - reached[i].length / reached[i - 1].length : 0));
  const worst = drops.indexOf(Math.max(...drops));
  const list = sel ? (sel.kind === "step" ? reached[sel.i] : stopped[sel.i]) : [];
  const toggle = (s: NonNullable<Sel>) => setSel(sel && sel.kind === s.kind && sel.i === s.i ? null : s);

  return (
    <div className="viz ft">
      <div className="viz-filters" role="group" aria-label="Filter by tier">
        {["all", "T1", "T2", "T3"].map((t) => <button key={t} type="button" className={`viz-chip${tier === t ? " on" : ""}`} onClick={() => { setTier(t); setSel(null); }}>{t === "all" ? "All" : t}</button>)}
        {worst > 0 && drops[worst] > 0 && <span className="viz-hint">Biggest drop: <b>{steps[worst - 1].label} → {steps[worst].label}</b></span>}
      </div>
      <ol className="ft-track" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const d = dia(reached[i].length), st = stopped[i].length;
          const conv = i && reached[i - 1].length ? Math.round((reached[i].length / reached[i - 1].length) * 100) : null;
          return (
            <li key={s.key} className={`ft-step${sel && sel.i !== i ? " dim" : ""}`}>
              {i > 0 && <span className={`ft-line${i === worst && drops[i] > 0 ? " worst" : ""}`}><em>{conv == null ? "—" : `${conv}%`}</em></span>}
              <button type="button" className={`ft-bub${sel?.kind === "step" && sel.i === i ? " on" : ""}`} style={{ width: d, height: d, background: RAMP[Math.round((i / Math.max(1, n - 1)) * (RAMP.length - 1))], color: i < 3 ? "#3B0764" : "#fff" }}
                onClick={() => toggle({ kind: "step", i })} title={`${s.define} · ${reached[i].length} companies`}>
                <span>{reached[i].length}</span>
              </button>
              {st > 0 && <button type="button" className={`ft-out${sel?.kind === "exit" && sel.i === i ? " on" : ""}`} onClick={() => toggle({ kind: "exit", i })} title={`${st} stopped here: ${reasons(stopped[i]).map(([k, v]) => `${k} ${v}`).join(", ")}`}>−{st}</button>}
              <span className="ft-l">{s.label}</span>
            </li>
          );
        })}
      </ol>
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
      <details className="chart-table">
        <summary>Show as table</summary>
        <table className="data compact"><thead><tr><th>Step</th><th className="text-right">Reached</th><th className="text-right">From step before</th><th className="text-right">Stopped here</th></tr></thead>
          <tbody>{steps.map((s, i) => <tr key={s.key}><td>{s.label}</td><td className="text-right tnum">{reached[i].length}</td><td className="text-right tnum">{i && reached[i - 1].length ? `${Math.round((reached[i].length / reached[i - 1].length) * 100)}%` : "—"}</td><td className="text-right tnum">{stopped[i].length}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
