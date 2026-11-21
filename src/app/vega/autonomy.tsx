"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
import { runVegaNow, saveVegaSettings, undoVegaAction } from "./actions";

const LABEL: Record<string, { name: string; help: string; cost: string }> = {
  rescore: { name: "Re-score after new signals", help: "Re-reads intent and priority when signals arrive", cost: "free" },
  refresh_research: { name: "Refresh stale research", help: "Top and mid priority companies, research older than 90 days, at most weekly", cost: "about $0.30 each" },
  prepare_drafts: { name: "Prepare drafts", help: "For people who are ready but have no draft; drafts wait in Approvals", cost: "about $0.10 each" },
  follow_up_task: { name: "Follow-up reminders", help: "A task for the owner when an email got no reply in 7 days", cost: "free" },
};

const EVENTS: Record<string, { name: string; help: string; cost: string }> = {
  hot_reply_handoff: { name: "Interested reply → owner task", help: "A task to reply within 24h, with the reply quoted", cost: "free" },
  question_task: { name: "Objection or unclear reply → owner task", help: "Follow-ups are already paused; the owner gets a task to answer", cost: "free" },
  ooo_reschedule: { name: "Out of office → reschedule", help: "Moves the next step to the day after they return", cost: "free" },
  find_replacement: { name: "Bounce or wrong person → find someone else", help: "Runs the buying-group step again for the same role", cost: "about $0.20 each" },
  meeting_prep: { name: "Call or demo booked → prep task", help: "A task with what to read before the meeting", cost: "free" },
};

export function AutonomyCard({ clientId, setting }: { clientId: string; setting: { enabled: boolean; paused: boolean; allowedTools: string[]; dailyCapUsd: number; spentTodayUsd: number } }) {
  const [enabled, setEnabled] = useState(setting.enabled);
  const [paused, setPaused] = useState(setting.paused);
  const [tools, setTools] = useState<string[]>(setting.allowedTools);
  const [cap, setCap] = useState(String(setting.dailyCapUsd));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () => start(async () => { const r = await saveVegaSettings({ clientId, enabled, paused, allowedTools: tools, dailyCapUsd: Number(cap) }); setMsg(r.message); router.refresh(); });
  const run = () => start(async () => { const r = await runVegaNow(clientId); setMsg(r.message); router.refresh(); });
  return (
    <div className="jv-card jv-auto">
      <div className="jv-card-h"><h2>Acts on its own</h2><span className={`jv-pill${enabled && !paused ? " on" : ""}`}>{enabled ? (paused ? "Paused" : "On") : "Off"}</span></div>
      <label className="jv-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Let Vega do safe internal work for this client</label>
      {enabled && <label className="jv-check"><input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Pause for now</label>}
      <fieldset className="jv-tools-set" disabled={!enabled}>
        <legend className="muted text-xs">Allowed</legend>
        {Object.entries(LABEL).map(([k, l]) => (
          <label key={k} className="jv-check" title={l.help}>
            <input type="checkbox" checked={tools.includes(k)} onChange={(e) => setTools((t) => (e.target.checked ? [...t, k] : t.filter((x) => x !== k)))} />
            <span>{l.name} <small className="muted">· {l.cost}</small></span>
          </label>
        ))}
      </fieldset>
      <fieldset className="jv-tools-set" disabled={!enabled}>
        <legend className="muted text-xs">React to events, then tell you</legend>
        {Object.entries(EVENTS).map(([k, l]) => (
          <label key={k} className="jv-check" title={l.help}>
            <input type="checkbox" checked={tools.includes(k)} onChange={(e) => setTools((t) => (e.target.checked ? [...t, k] : t.filter((x) => x !== k)))} />
            <span>{l.name} <small className="muted">· {l.cost}</small></span>
          </label>
        ))}
        <p className="jv-always">Always on, for every client: an opt-out or hard bounce stops LinkedIn and tasks too, and at 90% of the monthly budget Vega pauses its own paid work.</p>
      </fieldset>
      <label className="jv-cap">Daily limit $<input type="number" min={0} max={50} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} disabled={!enabled} /><small className="muted">${setting.spentTodayUsd.toFixed(2)} used today</small></label>
      <p className="muted text-xs">It never sends anything, never goes over the client&apos;s budget and never rules a company out. Every action is listed below with its reason.</p>
      <div className="jv-auto-btns">
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={pending}>Save</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={pending || !setting.enabled || setting.paused} title={!setting.enabled ? "Switch it on and save first" : "Run one pass now"}><Play size={13} /> Run now</button>
      </div>
      {msg && <p className="jv-auto-msg" role="status">{msg}</p>}
    </div>
  );
}

export function UndoButton({ clientId, actionId }: { clientId: string; actionId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  if (msg) return <small className="jv-undo-msg">{msg}</small>;
  return <button type="button" className="jv-undo" disabled={pending} onClick={() => start(async () => { const r = await undoVegaAction(clientId, actionId); setMsg(r.message); router.refresh(); })}><RotateCcw size={12} /> Undo</button>;
}
