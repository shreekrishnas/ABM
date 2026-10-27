"use client";

// Stage ladder: one tile per pipeline step. Each tile shows how many companies reached it, a
// bar for its share of everything imported, and who stopped there. Between tiles, the
// conversion from the step before. Click a tile (or its "stopped" chip) to list the companies.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FlowAccount } from "@/lib/command-center";

type Sel = { kind: "step" | "exit"; i: number } | null;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const HUES = ["#6D28D9", "#4F46E5", "#0284C7", "#7C3AED", "#4338CA", "#0369A1"];
const hue = (id: string) => HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export function StageLadder({ steps, accounts }: { steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[] }) {
  const [tier, setTier] = useState("all");
  const [sel, setSel] = useState<Sel>(null);
  const rows = useMemo(() => (tier === "all" ? accounts : accounts.filter((a) => (a.tier ?? "none") === tier)), [accounts, tier]);
  const reached = steps.map((_, i) => rows.filter((a) => a.reached >= i));
  const stopped = steps.map((_, i) => rows.filter((a) => a.reached === i));
  const top = Math.max(1, reached[0].length);
  const reasons = (list: FlowAccount[]) => Object.entries(list.reduce<Record<string, number>>((m, a) => ({ ...m, [a.reason]: (m[a.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  // The biggest drop between two steps is the bottleneck worth looking at first.
  const drops = steps.map((_, i) => (i && reached[i - 1].length ? 1 - reached[i].length / reached[i - 1].length : 0));
  const worst = drops.indexOf(Math.max(...drops));
  const list = sel ? (sel.kind === "step" ? reached[sel.i] : stopped[sel.i]) : [];

  return (
    <div className="viz">
      <div className="viz-filters" role="group" aria-label="Filter by tier">
        {["all", "T1", "T2", "T3"].map((t) => <button key={t} type="button" className={`viz-chip${tier === t ? " on" : ""}`} onClick={() => { setTier(t); setSel(null); }}>{t === "all" ? "All tiers" : t}</button>)}
        {worst > 0 && drops[worst] > 0 && <span className="viz-hint">Biggest drop: <b>{steps[worst - 1].label} → {steps[worst].label}</b> ({Math.round(drops[worst] * 100)}% don&apos;t continue)</span>}
      </div>
      <ol className="ld">
        {steps.map((s, i) => {
          const r = reached[i].length, st = stopped[i];
          const conv = i && reached[i - 1].length ? Math.round((r / reached[i - 1].length) * 100) : null;
          const on = sel?.i === i;
          return (
            <li key={s.key} className="ld-col">
              {i > 0 && <span className={`ld-conv${i === worst && drops[i] > 0 ? " worst" : ""}`} title={`${conv ?? 0}% of ${steps[i - 1].label.toLowerCase()} reached ${s.label.toLowerCase()}`}>{conv == null ? "—" : `${conv}%`}</span>}
              <button type="button" className={`ld-tile${on && sel?.kind === "step" ? " on" : ""}`} onClick={() => setSel(on && sel?.kind === "step" ? null : { kind: "step", i })} title={s.define}>
                <span className="ld-label">{s.label}</span>
                <span className="ld-n">{r}</span>
                <span className="ld-bar"><i style={{ height: `${Math.max(r ? 4 : 0, Math.round((r / top) * 100))}%` }} /></span>
                <span className="ld-share">{Math.round((r / top) * 100)}% of imported</span>
              </button>
              {st.length > 0 ? (
                <button type="button" className={`ld-stop${on && sel?.kind === "exit" ? " on" : ""}`} onClick={() => setSel(on && sel?.kind === "exit" ? null : { kind: "exit", i })} title={reasons(st).map(([k, v]) => `${k}: ${v}`).join("\n")}>
                  <span className="ld-avs">{st.slice(0, 4).map((a) => <i key={a.id} style={{ background: hue(a.id) }}>{initials(a.name)}</i>)}{st.length > 4 && <i className="more">+{st.length - 4}</i>}</span>
                  <span className="ld-stop-t">{st.length} stopped · {reasons(st)[0][0].toLowerCase()}</span>
                </button>
              ) : <span className="ld-stop empty">none stopped</span>}
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
