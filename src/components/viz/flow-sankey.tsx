"use client";

// Company flow: a Sankey of the pipeline. The main band narrows step by step; at each step a
// side band drops to the companies that stopped there. Hover any band for counts and reasons;
// click to list those companies. Tier chips re-filter the whole flow.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FlowAccount } from "@/lib/command-center";

type Sel = { kind: "step" | "exit"; i: number } | null;
const W = 1000, NODE = 12, TOP = 34, H_MAX = 150, EXIT_Y = 250;

function band(x1: number, a1: number, b1: number, x2: number, a2: number, b2: number) {
  const m = (x1 + x2) / 2;
  return `M${x1} ${a1}C${m} ${a1},${m} ${a2},${x2} ${a2}L${x2} ${b2}C${m} ${b2},${m} ${b1},${x1} ${b1}Z`;
}

export function FlowSankey({ steps, accounts }: { steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[] }) {
  const [tier, setTier] = useState<string>("all");
  const [hover, setHover] = useState<{ sel: NonNullable<Sel>; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const rows = useMemo(() => (tier === "all" ? accounts : accounts.filter((a) => (a.tier ?? "none") === tier)), [accounts, tier]);
  const n = steps.length;
  const count = steps.map((_, i) => rows.filter((a) => a.reached >= i).length);
  const exits = steps.map((_, i) => rows.filter((a) => a.reached === i));
  const scale = H_MAX / Math.max(1, count[0]);
  const gap = (W - 40) / n;
  const x = (i: number) => 20 + i * gap;
  const h = (v: number) => (v ? Math.max(2, v * scale) : 0);
  const exitMax = Math.max(0, ...steps.map((_, i) => h(count[i]) - (i + 1 < n ? h(count[i + 1]) : 0)));
  const VH = EXIT_Y + Math.max(2, exitMax) + 26;
  const pick = (s: NonNullable<Sel>) => (s.kind === "step" ? rows.filter((a) => a.reached >= s.i) : exits[s.i]);
  const reasons = (list: FlowAccount[]) => Object.entries(list.reduce<Record<string, number>>((m, a) => ({ ...m, [a.reason]: (m[a.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const isOn = (s: NonNullable<Sel>) => !sel || (sel.kind === s.kind && sel.i === s.i);
  const tip = hover ? pick(hover.sel) : [];
  const list = sel ? pick(sel) : [];

  return (
    <div className="viz">
      <div className="viz-filters" role="group" aria-label="Filter by tier">
        {["all", "T1", "T2", "T3"].map((t) => <button key={t} type="button" className={`viz-chip${tier === t ? " on" : ""}`} onClick={() => { setTier(t); setSel(null); }}>{t === "all" ? "All tiers" : t}</button>)}
        <span className="viz-hint">Hover a band for reasons · click to list the companies</span>
      </div>
      <div className="viz-stage" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${VH}`} role="img" aria-label="Company flow through the pipeline">
          {steps.map((s, i) => {
            const hi = h(count[i]), next = i + 1 < n ? h(count[i + 1]) : 0, out = hi - next;
            const stepSel = { kind: "step" as const, i };
            const exitSel = { kind: "exit" as const, i };
            return (
              <g key={s.key}>
                {i + 1 < n && count[i + 1] > 0 && (
                  <path d={band(x(i) + NODE, TOP, TOP + next, x(i + 1), TOP, TOP + next)} className={`viz-band main${isOn({ kind: "step", i: i + 1 }) ? "" : " dim"}`}
                    onMouseMove={(e) => setHover({ sel: { kind: "step", i: i + 1 }, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })} onClick={() => setSel({ kind: "step", i: i + 1 })} />
                )}
                {exits[i].length > 0 && (
                  <path d={band(x(i) + NODE, TOP + next, TOP + hi, x(i) + NODE + gap * 0.42, EXIT_Y, EXIT_Y + Math.max(2, out))} className={`viz-band exit${isOn(exitSel) ? "" : " dim"}`}
                    onMouseMove={(e) => setHover({ sel: exitSel, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })} onClick={() => setSel(exitSel)} />
                )}
                <rect x={x(i)} y={TOP} width={NODE} height={Math.max(2, hi)} rx="3" className={`viz-node${isOn(stepSel) ? "" : " dim"}`}
                  onMouseMove={(e) => setHover({ sel: stepSel, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })} onClick={() => setSel(stepSel)}><title>{s.define}</title></rect>
                <text x={x(i)} y={TOP - 18} className="viz-label">{s.label}</text>
                <text x={x(i)} y={TOP - 5} className="viz-num">{count[i]}</text>
                {exits[i].length > 0 && <text x={x(i) + NODE + gap * 0.42} y={EXIT_Y + Math.max(2, out) + 14} className="viz-sub">{exits[i].length} stopped</text>}
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="chart-tip viz-tip" style={{ left: Math.min(hover.x + 14, 760), top: hover.y + 10 }}>
            <div className="muted text-[11px]">{hover.sel.kind === "step" ? `Reached ${steps[hover.sel.i].label.toLowerCase()}` : `Stopped after ${steps[hover.sel.i].label.toLowerCase()}`}</div>
            <div className="font-semibold">{tip.length} compan{tip.length === 1 ? "y" : "ies"}{hover.sel.kind === "step" && hover.sel.i > 0 && count[hover.sel.i - 1] ? ` · ${Math.round((tip.length / count[hover.sel.i - 1]) * 100)}% of the step before` : ""}</div>
            {hover.sel.kind === "exit" && <ul className="viz-tip-list">{reasons(tip).slice(0, 5).map(([r, c]) => <li key={r}><span>{r}</span><b>{c}</b></li>)}</ul>}
          </div>
        )}
      </div>
      {sel && (
        <div className="viz-drill">
          <div className="viz-drill-head">
            <b>{sel.kind === "step" ? `${list.length} reached ${steps[sel.i].label.toLowerCase()}` : `${list.length} stopped after ${steps[sel.i].label.toLowerCase()}`}</b>
            <button type="button" className="viz-chip" onClick={() => setSel(null)}>Clear</button>
          </div>
          <ul>{list.slice(0, 40).map((a) => <li key={a.id}><Link href={`/accounts/${a.id}`}>{a.name}</Link><span className="viz-tag">{a.tier ?? "—"}</span>{sel.kind === "exit" && <span className="viz-reason">{a.reason}</span>}</li>)}</ul>
          {list.length > 40 && <p className="muted text-xs">and {list.length - 40} more</p>}
        </div>
      )}
      <details className="chart-table">
        <summary>Show as table</summary>
        <table className="data compact"><thead><tr><th>Step</th><th className="text-right">Reached</th><th className="text-right">Stopped here</th></tr></thead>
          <tbody>{steps.map((s, i) => <tr key={s.key}><td>{s.label}</td><td className="text-right tnum">{count[i]}</td><td className="text-right tnum">{exits[i].length}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
