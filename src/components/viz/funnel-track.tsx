"use client";

// Company flow as a funnel ribbon: one continuous band across the steps, its thickness the share
// of companies reaching each step. Counts and step names above; under each step, the conversion
// from the step before (biggest drop marked) and how many stopped there (click to list them).
// Tier chips re-filter; "Show as table" keeps every number readable without the picture.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FlowAccount } from "@/lib/command-center";

type Sel = { kind: "step" | "exit"; i: number } | null;

export function FunnelTrack({ steps, accounts }: { steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[] }) {
  const [tier, setTier] = useState("all");
  const [sel, setSel] = useState<Sel>(null);
  const rows = useMemo(() => (tier === "all" ? accounts : accounts.filter((a) => (a.tier ?? "none") === tier)), [accounts, tier]);
  const n = steps.length;
  const reached = steps.map((_, i) => rows.filter((a) => a.reached >= i));
  const stopped = steps.map((_, i) => rows.filter((a) => a.reached === i));
  const top = Math.max(1, reached[0].length);
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
      {(() => {
        // The ribbon: one band across the steps; its thickness is the share of companies reaching each step.
        const W = 100 * n, H = 64, mid = H / 2, minH = 7;
        const h = reached.map((r) => (r.length ? Math.max(minH, (r.length / top) * (H - 4)) : 1.5));
        const x = (i: number) => i * 100 + 50;
        let topEdge = `M 0 ${mid - h[0] / 2} L ${x(0)} ${mid - h[0] / 2}`;
        let botEdge = "";
        for (let i = 1; i < n; i++) {
          const cx = (x(i - 1) + x(i)) / 2;
          topEdge += ` C ${cx} ${mid - h[i - 1] / 2}, ${cx} ${mid - h[i] / 2}, ${x(i)} ${mid - h[i] / 2}`;
        }
        topEdge += ` L ${W} ${mid - h[n - 1] / 2} L ${W} ${mid + h[n - 1] / 2} L ${x(n - 1)} ${mid + h[n - 1] / 2}`;
        for (let i = n - 1; i > 0; i--) {
          const cx = (x(i - 1) + x(i)) / 2;
          botEdge += ` C ${cx} ${mid + h[i] / 2}, ${cx} ${mid + h[i - 1] / 2}, ${x(i - 1)} ${mid + h[i - 1] / 2}`;
        }
        const d = `${topEdge}${botEdge} L 0 ${mid + h[0] / 2} Z`;
        return (
          <div className="fn" style={{ ["--n" as string]: n }}>
            <ol className="fn-head">
              {steps.map((s, i) => {
                const v = reached[i].length;
                return (
                  <li key={s.key} className={`${v ? "" : "zero"}${sel && sel.i !== i ? " dim" : ""}`}>
                    <button type="button" className={`fn-step${sel?.kind === "step" && sel.i === i ? " on" : ""}`} onClick={() => v && toggle({ kind: "step", i })} title={s.define} disabled={!v}>
                      <b className="tnum">{v}</b>
                      <span>{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <svg className="fn-ribbon" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="fn-grad" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" className="fn-s1" />
                  <stop offset="100%" className="fn-s2" />
                </linearGradient>
              </defs>
              {steps.slice(1).map((_, i) => <line key={i} x1={(i + 1) * 100} x2={(i + 1) * 100} y1={0} y2={H} className="fn-grid" />)}
              <path d={d} fill="url(#fn-grad)" />
            </svg>
            <ol className="fn-foot">
              {steps.map((s, i) => {
                const st = stopped[i].length;
                const prev = i ? reached[i - 1].length : null;
                const conv = prev ? Math.round((reached[i].length / prev) * 100) : null;
                return (
                  <li key={s.key}>
                    {i > 0 && <span className={`fn-conv tnum${i === worst && drops[i] > 0 ? " worst" : ""}`}>{conv == null ? "—" : `${conv}%`}</span>}
                    {st > 0 && <button type="button" className={`fn-out${sel?.kind === "exit" && sel.i === i ? " on" : ""}`} onClick={() => toggle({ kind: "exit", i })} title={`${st} stopped here: ${reasons(stopped[i]).map(([k, v]) => `${k} ${v}`).join(", ")}`}>{st} stopped</button>}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })()}
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
