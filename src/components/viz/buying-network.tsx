"use client";

// Buying group, compact: one row per function, its people as chips. The chip's dot is where they
// are in outreach, the bar under the name is how much we've interacted with them. Key roles nobody
// has been found for are listed at the end. Role chips filter.

import Link from "next/link";
import { useState } from "react";

export interface NetPerson { id: string; name: string; title: string | null; fn: string; role: string; status: string; interactions: number }
const STATUS: Record<string, { color: string; label: string }> = {
  engaged: { color: "#059669", label: "Engaged" }, contacted: { color: "#4F46E5", label: "Contacted" },
  planned: { color: "#B45309", label: "Planned" }, found: { color: "#94A3B8", label: "Found" },
};
const ROLE_WORD: Record<string, string> = { decision_maker: "Decision maker", champion: "Champion", influencer: "Influencer", budget_owner: "Budget owner", unknown: "Role unknown" };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function BuyingNetwork({ people, missing }: { company: string; people: NetPerson[]; missing: string[] }) {
  const [role, setRole] = useState<string>("all");
  if (!people.length) return <p className="muted text-sm">No people found yet. They appear here once research identifies the owning function and the buying group.</p>;
  const roles = [...new Set(people.map((p) => p.role))];
  const fns = [...new Set(people.map((p) => p.fn))].sort((a, b) => (a === "Function unknown" ? 1 : b === "Function unknown" ? -1 : a.localeCompare(b)));
  const maxI = Math.max(1, ...people.map((p) => p.interactions));
  const shown = (p: NetPerson) => role === "all" || p.role === role;

  return (
    <div className="bg">
      <div className="bg-bar">
        <div className="viz-filters">
          <button type="button" className={`viz-chip${role === "all" ? " on" : ""}`} onClick={() => setRole("all")}>Everyone · {people.length}</button>
          {roles.map((r) => <button key={r} type="button" className={`viz-chip${role === r ? " on" : ""}`} onClick={() => setRole(r)}>{ROLE_WORD[r] ?? r}</button>)}
        </div>
        <span className="bg-legend">{Object.values(STATUS).map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</span>
      </div>
      <div className="bg-rows">
        {fns.map((f) => {
          const group = people.filter((p) => p.fn === f);
          return (
            <div key={f} className="bg-row">
              <span className="bg-fn">{f}<small>{group.length}</small></span>
              <div className="bg-people">
                {group.map((p) => {
                  const s = STATUS[p.status] ?? STATUS.found;
                  return (
                    <Link key={p.id} href={`/people/${p.id}`} className={`bg-p${shown(p) ? "" : " dim"}`} title={`${p.name}${p.title ? ` · ${p.title}` : ""} · ${ROLE_WORD[p.role] ?? p.role} · ${s.label} · ${p.interactions} interaction${p.interactions === 1 ? "" : "s"}`}>
                      <span className="bg-av" style={{ boxShadow: `0 0 0 2px ${s.color}` }}>{initials(p.name)}</span>
                      <span className="bg-txt">
                        <b>{p.name}</b>
                        <small>{p.title ?? ROLE_WORD[p.role] ?? "—"}</small>
                        <span className="bg-int"><i style={{ width: `${(p.interactions / maxI) * 100}%` }} /></span>
                      </span>
                      {(p.role === "decision_maker" || p.role === "champion") && <span className="bg-role">{p.role === "champion" ? "Champion" : "DM"}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
        {missing.length > 0 && (
          <div className="bg-row bg-missing">
            <span className="bg-fn">Not found yet</span>
            <div className="bg-people">{missing.map((m) => <span key={m} className="bg-gap">No {m.toLowerCase()} found</span>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
