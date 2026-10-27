"use client";

// Funnel ribbon: one continuous glass shape whose height at each step is the number of
// companies that reached it, deepening in colour as companies get closer to revenue.
// Conversion chips sit on each join (the biggest drop in red); companies that stopped hang
// beneath their step. Hover a step to light it; click a step or a stopped group to list them.

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FlowAccount } from "@/lib/command-center";

type Sel = { kind: "step" | "exit"; i: number } | null;
// Ordinal violet ramp: early steps light, late steps deep.
const RAMP = ["#C4B5FD", "#B39DFB", "#A78BFA", "#9576F7", "#8B5CF6", "#7C3AED", "#6D28D9", "#5B21B6"];
const W = 800, H = 170, MID = H / 2, MAXH = 76, MINH = 7, GAP = 2;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const HUES = ["#6D28D9", "#4F46E5", "#0284C7", "#7C3AED", "#4338CA", "#0369A1"];
const hue = (id: string) => HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export function FunnelRibbon({ steps, accounts }: { steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[] }) {
  const [tier, setTier] = useState("all");
  const [sel, setSel] = useState<Sel>(null);
  const [hov, setHov] = useState<number | null>(null);
  const rows = useMemo(() => (tier === "all" ? accounts : accounts.filter((a) => (a.tier ?? "none") === tier)), [accounts, tier]);
  const n = steps.length, seg = W / n;
  const reached = steps.map((_, i) => rows.filter((a) => a.reached >= i));
  const stopped = steps.map((_, i) => rows.filter((a) => a.reached === i));
  const top = Math.max(1, reached[0].length);
  const half = (v: number) => (v ? Math.max(MINH, (v / top) * MAXH) : 2);
  const reasons = (list: FlowAccount[]) => Object.entries(list.reduce<Record<string, number>>((m, a) => ({ ...m, [a.reason]: (m[a.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const drops = steps.map((_, i) => (i && reached[i - 1].length ? 1 - reached[i].length / reached[i - 1].length : 0));
  const worst = drops.indexOf(Math.max(...drops));
  const list = sel ? (sel.kind === "step" ? reached[sel.i] : stopped[sel.i]) : [];
  const lit = (i: number) => (sel ? sel.i === i : hov == null || hov === i);

  // Each step: flat for its first 55%, then eases down to the next step's height.
  const shape = (i: number) => {
    const x0 = i * seg + GAP / 2, x1 = (i + 1) * seg - GAP / 2, xf = x0 + (x1 - x0) * 0.55;
    const a = half(reached[i].length), b = i + 1 < n ? half(reached[i + 1].length) : a;
    const c = (xf + x1) / 2;
    return `M${x0} ${MID - a}L${xf} ${MID - a}C${c} ${MID - a},${c} ${MID - b},${x1} ${MID - b}L${x1} ${MID + b}C${c} ${MID + b},${c} ${MID + a},${xf} ${MID + a}L${x0} ${MID + a}Z`;
  };

  return (
    <div className="viz fr">
      <div className="viz-filters" role="group" aria-label="Filter by tier">
        {["all", "T1", "T2", "T3"].map((t) => <button key={t} type="button" className={`viz-chip${tier === t ? " on" : ""}`} onClick={() => { setTier(t); setSel(null); }}>{t === "all" ? "All tiers" : t}</button>)}
        {worst > 0 && drops[worst] > 0 && <span className="viz-hint">Biggest drop: <b>{steps[worst - 1].label} → {steps[worst].label}</b> · {Math.round(drops[worst] * 100)}% don&apos;t continue</span>}
      </div>

      <div className="fr-stage">
        <div className="fr-grid fr-heads">
          {steps.map((s, i) => (
            <button key={s.key} type="button" className={`fr-head${lit(i) ? "" : " dim"}`} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => setSel(sel?.kind === "step" && sel.i === i ? null : { kind: "step", i })} title={s.define}>
              <span className="fr-n">{reached[i].length}</span>
              <span className="fr-l">{s.label}</span>
            </button>
          ))}
        </div>

        <div className="fr-ribbon">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Companies reaching each pipeline step">
            <defs>
              <linearGradient id="fr-sheen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.55" /><stop offset="0.45" stopColor="#fff" stopOpacity="0.08" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            {steps.map((s, i) => (
              <g key={s.key} className={`fr-seg${lit(i) ? "" : " dim"}${sel?.i === i && sel.kind === "step" ? " on" : ""}`} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => setSel(sel?.kind === "step" && sel.i === i ? null : { kind: "step", i })}>
                <path d={shape(i)} fill={RAMP[Math.round((i / Math.max(1, n - 1)) * (RAMP.length - 1))]} />
                <path d={shape(i)} fill="url(#fr-sheen)" />
              </g>
            ))}
          </svg>
          {steps.map((_, i) => i > 0 && (
            <span key={i} className={`fr-conv${i === worst && drops[i] > 0 ? " worst" : ""}`} style={{ left: `${(i / n) * 100}%` }}>
              {reached[i - 1].length ? `${Math.round((reached[i].length / reached[i - 1].length) * 100)}%` : "—"}
            </span>
          ))}
        </div>

        <div className="fr-grid fr-stops">
          {steps.map((s, i) => {
            const st = stopped[i];
            return st.length ? (
              <button key={s.key} type="button" className={`fr-stop${sel?.kind === "exit" && sel.i === i ? " on" : ""}`} onClick={() => setSel(sel?.kind === "exit" && sel.i === i ? null : { kind: "exit", i })} title={reasons(st).map(([k, v]) => `${k}: ${v}`).join("\n")}>
                <span className="fr-drip" />
                <span className="fr-avs">{st.slice(0, 3).map((a) => <i key={a.id} style={{ background: hue(a.id) }}>{initials(a.name)}</i>)}{st.length > 3 && <i className="more">+{st.length - 3}</i>}</span>
                <span className="fr-st">{st.length} stopped</span>
                <span className="fr-why">{reasons(st)[0][0]}</span>
              </button>
            ) : <span key={s.key} className="fr-stop none" />;
          })}
        </div>
      </div>

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
