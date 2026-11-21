"use client";
// Vega on Home: a live animated core you click to talk to it. Opens a panel on the same page
// with the conversation and what Vega did today; the full workspace stays one link away.

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import { VegaChat } from "@/app/vega/chat";
import { RecommendedApprovals, type RecItem } from "@/app/vega/approvals";

export interface OrbAction { id: string; reason: string; status: string; at: string }

/** The Vega core: a dark device with a tick bezel, a sweeping scan, counter-rotating rings and a glowing centre. */
function Core({ size = 48, busy = false, live = false }: { size?: number; busy?: boolean; live?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg className={`jo-core${busy ? " busy" : ""}${live ? " live" : ""}`} width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="jo-g0" />
          <stop offset="45%" className="jo-g1" />
          <stop offset="100%" className="jo-g2" />
        </radialGradient>
        <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" className="jo-s0" />
          <stop offset="100%" className="jo-s1" />
        </linearGradient>
        <filter id={`${id}-bloom`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <circle cx="60" cy="60" r="58" className="jo-disc" />
      <circle cx="60" cy="60" r="57" className="jo-rim" />
      <g className="jo-ring r3">
        {Array.from({ length: 24 }, (_, i) => <rect key={i} x="59.25" y="6" width="1.5" height={i % 6 === 0 ? 7 : 4} rx=".75" className={`jo-tick${i % 6 === 0 ? " major" : ""}`} transform={`rotate(${i * 15} 60 60)`} />)}
      </g>
      <g className="jo-ring scan"><path d="M60 60 L60 14 A46 46 0 0 1 99.8 37 Z" fill={`url(#${id}-sweep)`} className="jo-scan" /></g>
      <g className="jo-ring r1"><circle cx="60" cy="60" r="40" className="jo-arc a1" /></g>
      <g className="jo-ring r2"><circle cx="60" cy="60" r="31" className="jo-arc a2" /></g>
      <circle cx="60" cy="60" r="22" fill={`url(#${id}-glow)`} filter={`url(#${id}-bloom)`} className="jo-bloom" />
      <circle cx="60" cy="60" r="15" className="jo-lens" />
      <circle cx="60" cy="60" r="7" className="jo-eye" />
    </svg>
  );
}

export function VegaOrb({ clientId, clientName, doneToday, waiting, actions, on, recs = [], agreement = { decisions: 0, agreedShare: null } }: { clientId: string; clientName: string; doneToday: number; waiting: number; actions: OrbAction[]; on: boolean; recs?: RecItem[]; agreement?: { decisions: number; agreedShare: number | null } }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);

  const status = !on ? "Standing by · not acting on its own yet" : doneToday ? `${doneToday} thing${doneToday === 1 ? "" : "s"} done today` : "Watching · nothing needed doing yet";
  const strong = recs.filter((r) => r.strength === "strong").length;

  return (
    <>
      <span className="jo-wrap">
        <button type="button" className={`jo ${on ? "on" : "off"}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Open Vega. ${status}.${waiting ? ` ${waiting} waiting for you.` : ""}`} aria-describedby="jo-tip">
          <Core live={on && doneToday > 0} />
          <i className={`jo-dot ${on ? (waiting ? "warn" : "ok") : "idle"}`} aria-hidden />
          {strong > 0 && <span className="jo-badge tnum" aria-hidden>{strong}</span>}
        </button>
        <span className="jo-tip" id="jo-tip" role="tooltip">
          <b>Vega</b>
          <span className="jo-tip-what">Watches {clientName}&apos;s accounts, does safe work on its own, and asks before anything goes out.</span>
          <span className="jo-tip-row"><i className={`jo-dot inline ${on ? "ok" : "idle"}`} />{status}</span>
          {waiting > 0 && <span className="jo-tip-row"><i className="jo-dot inline warn" />{waiting} waiting for you{strong ? ` · ${strong} strong email${strong === 1 ? "" : "s"} ready` : ""}</span>}
          <span className="jo-tip-cta">Click to talk</span>
        </span>
      </span>

      {open && createPortal(
        <div className="jo-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <aside className="jo-panel" role="dialog" aria-modal="true" aria-label="Vega">
            <header className="jo-head">
              <Core size={40} busy />
              <div className="min-w-0">
                <b>Vega</b>
                <span>{clientName} · {status}</span>
              </div>
              <Link href={`/vega?c=${clientId}`} className="jo-full" prefetch={false}>Full workspace <ArrowUpRight size={13} /></Link>
              <button type="button" className="jo-x" onClick={() => setOpen(false)} aria-label="Close Vega (Esc)"><X size={16} /></button>
            </header>
            {actions.length > 0 && (
              <section className="jo-did" aria-label="What Vega did">
                <h3>What I did recently</h3>
                <ul>{actions.map((a) => <li key={a.id} className={a.status}><span>{a.reason}</span><small>{a.status === "done" ? "done" : a.status} · {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></li>)}</ul>
              </section>
            )}
            {recs.length > 0 && <div className="jo-rec"><RecommendedApprovals clientId={clientId} items={recs} agreement={agreement} /></div>}
            <div className="jo-chat"><VegaChat clientId={clientId} clientName={clientName} accountId={null} accountName={null} conversationId={null} initial={[]} /></div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
