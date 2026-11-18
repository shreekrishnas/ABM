"use client";
// Home's interactive panels in the workspace layout: the decision queue with its filter, the
// account progression grid with stage details, and the stage-count export.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Download, LayoutGrid, Table2 } from "lucide-react";
import type { FlowAccount } from "@/lib/command-center";

export interface QueueItem { id: string; kind: "exception" | "approval"; label: string; title: string; description: string | null; href: string; ago: string }

const initials = (s: string) => s.split(/[\s·&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export function DecisionPanel({ items, counts, ages }: { items: QueueItem[]; counts: { all: number; exception: number; approval: number }; ages?: { today: number; few: number; old: number } }) {
  const agesTotal = ages ? ages.today + ages.few + ages.old : 0;
  const [f, setF] = useState<"all" | "exception" | "approval">("all");
  const shown = items.filter((i) => f === "all" || i.kind === f).slice(0, 4);
  return (
    <section className="ws-panel" aria-labelledby="ws-dc">
      <div className="ws-panel-head">
        <div>
          <div className="ws-eyebrow sm">01 / Execution</div>
          <h3 id="ws-dc">Decision center <span className="ws-tag amber">{counts.all} pending</span></h3>
          <p>Review outstanding actions and exceptions in one place.</p>
        </div>
        <div className="k-seg" role="group" aria-label="Filter decisions">
          {(["all", "exception", "approval"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{k === "all" ? "All" : k === "exception" ? "Exceptions" : "Approvals"}</button>
          ))}
        </div>
      </div>
      {ages && agesTotal > 0 && (
        <div className="ws-ages" aria-label={`Age of open decisions: ${ages.today} from today, ${ages.few} from 1 to 3 days, ${ages.old} older`}>
          <div className="ws-ages-bar" aria-hidden>
            {ages.today > 0 && <i className="a0" style={{ flex: ages.today }} />}
            {ages.few > 0 && <i className="a1" style={{ flex: ages.few }} />}
            {ages.old > 0 && <i className="a2" style={{ flex: ages.old }} />}
          </div>
          <div className="ws-ages-key"><span><i className="a0" />Today {ages.today}</span><span><i className="a1" />1–3 days {ages.few}</span><span><i className="a2" />Older {ages.old}</span></div>
        </div>
      )}
      <div className="ws-queue">
        {shown.length === 0 ? <p className="ws-empty">Nothing waiting here.</p> : shown.map((q) => (
          <div key={q.id} className={`ws-qrow ${q.kind}`}>
            <span className="ws-initial" aria-hidden>{initials(q.title)}</span>
            <div className="min-w-0">
              <div className="ws-qtitle">{q.title}<span className={`ws-tag ${q.kind === "exception" ? "red" : "purple"}`}>{q.label}</span></div>
              <div className="ws-qdesc">{q.description ? `${q.description} · ` : ""}{q.ago}</div>
            </div>
            <Link href={q.href} scroll={false} className="ws-btn small">Preview <ArrowUpRight size={12} /></Link>
          </div>
        ))}
      </div>
      <div className="ws-panel-foot">
        <span>Showing {shown.length} of {f === "all" ? counts.all : counts[f]} pending</span>
        <Link href="/review" className="ws-link">Open decision queue →</Link>
      </div>
    </section>
  );
}

const TIERS = [["all", "All priorities"], ["T1", "Top priority"], ["T2", "Mid priority"], ["T3", "Broad"]] as const;

export function JourneyPanel({ steps, accounts, start }: { steps: { key: string; label: string; define: string }[]; accounts: FlowAccount[]; start: number }) {
  const [tier, setTier] = useState("all");
  const [sel, setSel] = useState(Math.max(0, start));
  const [table, setTable] = useState(false);
  const rows = useMemo(() => (tier === "all" ? accounts : accounts.filter((a) => a.tier === tier)), [accounts, tier]);
  const n = steps.map((_, i) => rows.filter((a) => a.reached >= i).length);
  const top = Math.max(1, n[0]);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const change = (i: number) => (i === 0 ? "Entry point" : n[i - 1] ? `${pct(n[i], n[i - 1])}% of ${steps[i - 1].label.toLowerCase()}` : "No conversions yet");
  let worst = -1;
  for (let i = 1; i < n.length; i++) if (n[i - 1] && (worst < 0 || n[i] / n[i - 1] < n[worst] / n[worst - 1])) worst = i;
  const s = steps[sel];
  const stopped = rows.filter((a) => a.reached === sel);
  const chips = (stopped.length ? stopped : rows.filter((a) => a.reached >= sel)).slice(0, 6);
  const reasons = Object.entries(stopped.reduce<Record<string, number>>((m, a) => ({ ...m, [a.reason]: (m[a.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const next = sel + 1 < steps.length ? sel + 1 : -1;

  return (
    <section className="ws-panel ws-wide" id="journey" aria-labelledby="ws-jr">
      <div className="ws-panel-head">
        <div>
          <div className="ws-eyebrow sm">03 / Journey intelligence</div>
          <h3 id="ws-jr">Account progression</h3>
          <p>Inspect a stage, its transition rate, and the accounts behind it.</p>
        </div>
        <div className="ws-tools">
          <select className="ws-select" aria-label="Filter by priority" value={tier} onChange={(e) => setTier(e.target.value)}>
            {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" className="ws-btn small" onClick={() => setTable(!table)}>{table ? <><LayoutGrid size={13} /> Journey view</> : <><Table2 size={13} /> Table view</>}</button>
        </div>
      </div>
      <div className="ws-pipe">
        <ol className="ws-funnel" aria-label="Companies reaching each step">
          {steps.map((st, i) => (
            <li key={st.key}>
              <Link href={`/accounts?flow=${st.key}`} className={`ws-funnel-row${i === worst ? " worst" : ""}`} title={`${st.define} · see these ${n[i]} companies`}>
                <span className="ws-funnel-l">{st.label}</span>
                <span className="ws-funnel-track"><span style={{ width: `${Math.max(n[i] ? 2 : 0, pct(n[i], top))}%` }} /></span>
                <b className="tnum">{n[i]}</b>
                <span className="ws-funnel-c tnum">{i ? `${n[i - 1] ? pct(n[i], n[i - 1]) : 0}%` : ""}</span>
              </Link>
            </li>
          ))}
        </ol>
        {table ? (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead><tr><th>Stage</th><th>Accounts</th><th>Transition</th><th>Review</th></tr></thead>
              <tbody>{steps.map((st, i) => <tr key={st.key}><td><strong>{st.label}</strong></td><td className="tnum">{n[i]}</td><td>{change(i)}</td><td><button type="button" className="ws-link" onClick={() => { setSel(i); setTable(false); }}>Inspect ↗</button></td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <div className="ws-stages">
            {steps.map((st, i) => (
              <button key={st.key} type="button" className={`ws-stage${i === sel ? " selected" : ""}`} aria-pressed={i === sel} onClick={() => setSel(i)} title={st.define}>
                <div className="num tnum">{n[i]}</div>
                <div className="label">{st.label}</div>
                <div className="bar"><span style={{ width: `${pct(n[i], top)}%` }} /></div>
                <div className={`change${i === worst || (i > 0 && n[i - 1] > 0 && n[i] === 0) ? " problem" : ""}`}>{change(i)}</div>
              </button>
            ))}
          </div>
        )}
        <div className="ws-detail">
          <div className="ws-dcard">
            <div className="ws-dcard-top"><h4>{s.label} · {n[sel]} compan{n[sel] === 1 ? "y" : "ies"}</h4><span className="ws-tag purple">Stage {sel + 1} of {steps.length}</span></div>
            <p>{s.define}</p>
            <div className="ws-chips">
              {chips.length ? chips.map((a) => <Link key={a.id} href={`?peek=a_${a.id}`} scroll={false} className="ws-chip">{a.name} ↗</Link>) : <span className="ws-muted">No account records at this stage.</span>}
            </div>
          </div>
          <div className="ws-dcard">
            <h4>Pipeline interpretation</h4>
            <div className="ws-note">{stopped.length ? `${stopped.length} compan${stopped.length === 1 ? "y" : "ies"} stopped at ${s.label.toLowerCase()}${reasons.length ? `: ${reasons.slice(0, 3).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ")}` : ""}.` : `No company is stuck at ${s.label.toLowerCase()} right now.`}</div>
            {next > 0 && <div className="ws-note">{pct(n[next], n[sel])}% moved on to {steps[next].label.toLowerCase()}.</div>}
            {worst > 0 && <div className="ws-note">{worst === next ? "This is the largest conversion gap in the current flow." : `The largest gap is ${steps[worst - 1].label.toLowerCase()} → ${steps[worst].label.toLowerCase()}.`}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ExportView({ rows }: { rows: [string, number, string][] }) {
  const save = () => {
    const csv = [["Stage", "Accounts", "Transition"], ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "account-progression.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return <button type="button" className="ws-btn" onClick={save}><Download size={14} /> Export view</button>;
}
