"use client";

// Buying-group network: the company at the centre, the functions we know people in, and the
// people. Only known relationships are drawn (company → function → person); line weight is how
// many interactions we've had with that person. Ring colour = where they are in outreach.
// Hollow markers show key roles nobody has been found for yet.

import Link from "next/link";
import { useState } from "react";

export interface NetPerson { id: string; name: string; title: string | null; fn: string; role: string; status: string; interactions: number }
const STATUS: Record<string, { color: string; label: string }> = {
  engaged: { color: "#059669", label: "Engaged" }, contacted: { color: "#4F46E5", label: "Contacted" },
  planned: { color: "#B45309", label: "Planned" }, found: { color: "#64748B", label: "Found" },
};
const ROLE_WORD: Record<string, string> = { decision_maker: "Decision maker", champion: "Champion", influencer: "Influencer", budget_owner: "Budget owner", unknown: "Role unknown" };
const W = 760, H = 460, CX = W / 2, CY = H / 2;

export function BuyingNetwork({ company, people, missing }: { company: string; people: NetPerson[]; missing: string[] }) {
  const [role, setRole] = useState<string>("all");
  const [hover, setHover] = useState<string | null>(null);
  const fns = [...new Set(people.map((p) => p.fn))];
  const maxI = Math.max(1, ...people.map((p) => p.interactions));
  const fnPos = new Map(fns.map((f, i) => { const a = (i / Math.max(1, fns.length)) * Math.PI * 2 - Math.PI / 2; return [f, { a, x: CX + Math.cos(a) * 120, y: CY + Math.sin(a) * 120 }]; }));
  const pos = new Map<string, { x: number; y: number }>();
  for (const f of fns) {
    const group = people.filter((p) => p.fn === f), base = fnPos.get(f)!;
    const spread = Math.min(Math.PI / 1.6, (Math.PI * 2) / Math.max(1, fns.length) * 0.8);
    group.forEach((p, j) => { const a = base.a + (group.length === 1 ? 0 : (j / (group.length - 1) - 0.5) * spread); pos.set(p.id, { x: CX + Math.cos(a) * 205, y: CY + Math.sin(a) * 185 }); });
  }
  const dim = (p: NetPerson) => role !== "all" && p.role !== role;
  const hp = people.find((p) => p.id === hover);
  const roles = [...new Set(people.map((p) => p.role))];
  if (!people.length) return <p className="muted text-sm">No people found yet. They appear here once research identifies the owning function and the buying group.</p>;

  return (
    <div className="viz">
      <div className="viz-filters">
        <button type="button" className={`viz-chip${role === "all" ? " on" : ""}`} onClick={() => setRole("all")}>Everyone</button>
        {roles.map((r) => <button key={r} type="button" className={`viz-chip${role === r ? " on" : ""}`} onClick={() => setRole(r)}>{ROLE_WORD[r] ?? r}</button>)}
        <span className="viz-legend">{Object.entries(STATUS).map(([k, s]) => <span key={k}><i style={{ borderColor: s.color }} />{s.label}</span>)}</span>
      </div>
      <div className="viz-stage">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Buying group network for ${company}`}>
          {fns.map((f) => { const p = fnPos.get(f)!; return <line key={f} x1={CX} y1={CY} x2={p.x} y2={p.y} className="viz-edge" />; })}
          {people.map((p) => { const a = pos.get(p.id)!, f = fnPos.get(p.fn)!; return <line key={p.id} x1={f.x} y1={f.y} x2={a.x} y2={a.y} className={`viz-edge${dim(p) ? " dim" : ""}${hover === p.id ? " hot" : ""}`} strokeWidth={1 + (p.interactions / maxI) * 4} />; })}
          <g><circle cx={CX} cy={CY} r={34} className="viz-hub" /><text x={CX} y={CY + 4} textAnchor="middle" className="viz-hub-t">{company.length > 14 ? company.slice(0, 13) + "…" : company}</text></g>
          {fns.map((f) => { const p = fnPos.get(f)!; return <g key={f}><circle cx={p.x} cy={p.y} r={18} className="viz-fn" /><text x={p.x} y={p.y + 32} textAnchor="middle" className="viz-sub">{f}</text></g>; })}
          {people.map((p) => {
            const a = pos.get(p.id)!, r = 13 + Math.round((p.interactions / maxI) * 7), c = STATUS[p.status]?.color ?? "#64748B";
            return (
              <Link key={p.id} href={`/people/${p.id}`}>
                <g className={`viz-person${dim(p) ? " dim" : ""}`} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}>
                  <circle cx={a.x} cy={a.y} r={r + 6} fill="transparent" />
                  <circle cx={a.x} cy={a.y} r={r} className="viz-pnode" stroke={c} />
                  <text x={a.x} y={a.y + 4} textAnchor="middle" className="viz-ini">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</text>
                  <text x={a.x} y={a.y + r + 14} textAnchor="middle" className="viz-sub">{p.name.split(" ")[0]}</text>
                </g>
              </Link>
            );
          })}
          {missing.map((m, i) => { const x = 40 + i * 150, y = H - 26; return <g key={m}><circle cx={x} cy={y} r={9} className="viz-missing" /><text x={x + 16} y={y + 4} className="viz-sub">No {m.toLowerCase()} found</text></g>; })}
        </svg>
        {hp && (() => { const a = pos.get(hp.id)!; return (
          <div className="chart-tip viz-tip" style={{ left: `${(a.x / W) * 100}%`, top: `${(a.y / H) * 100}%`, transform: "translate(34px, -50%)" }}>
            <div className="font-semibold">{hp.name}</div>
            <div className="muted text-[11px]">{hp.title ?? "—"} · {hp.fn}</div>
            <div className="text-[12px]">{ROLE_WORD[hp.role] ?? hp.role} · {STATUS[hp.status]?.label ?? hp.status} · {hp.interactions} interaction{hp.interactions === 1 ? "" : "s"}</div>
          </div>
        ); })()}
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table className="data compact"><thead><tr><th>Person</th><th>Function</th><th>Role</th><th>Status</th><th className="text-right">Interactions</th></tr></thead>
          <tbody>{people.map((p) => <tr key={p.id}><td><Link href={`/people/${p.id}`} className="underline">{p.name}</Link></td><td>{p.fn}</td><td>{ROLE_WORD[p.role] ?? p.role}</td><td>{STATUS[p.status]?.label ?? p.status}</td><td className="text-right tnum">{p.interactions}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
