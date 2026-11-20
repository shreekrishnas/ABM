"use client";
// JARVIS on Home: a live animated core you click to talk to it. Opens a panel on the same page
// with the conversation and what JARVIS did today; the full workspace stays one link away.

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import { JarvisChat } from "@/app/jarvis/chat";
import { RecommendedApprovals, type RecItem } from "@/app/jarvis/approvals";

export interface OrbAction { id: string; reason: string; status: string; at: string }

function Core({ size = 88, busy = false }: { size?: number; busy?: boolean }) {
  return (
    <svg className={`jo-core${busy ? " busy" : ""}`} width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <radialGradient id="jo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="jo-g0" />
          <stop offset="60%" className="jo-g1" />
          <stop offset="100%" className="jo-g2" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="56" className="jo-halo" />
      <g className="jo-ring r1"><circle cx="60" cy="60" r="50" className="jo-dash d1" /></g>
      <g className="jo-ring r2"><circle cx="60" cy="60" r="41" className="jo-dash d2" /></g>
      <g className="jo-ring r3">
        {Array.from({ length: 12 }, (_, i) => <rect key={i} x="58.5" y="23" width="3" height="7" rx="1.5" className="jo-tick" transform={`rotate(${i * 30} 60 60)`} />)}
      </g>
      <circle cx="60" cy="60" r="24" fill="url(#jo-glow)" className="jo-pulse" />
      <circle cx="60" cy="60" r="11" className="jo-eye" />
    </svg>
  );
}

export function JarvisOrb({ clientId, clientName, doneToday, waiting, actions, on, recs = [], agreement = { decisions: 0, agreedShare: null } }: { clientId: string; clientName: string; doneToday: number; waiting: number; actions: OrbAction[]; on: boolean; recs?: RecItem[]; agreement?: { decisions: number; agreedShare: number | null } }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);

  const status = !on ? "Standing by · not acting on its own for this client" : doneToday ? `${doneToday} thing${doneToday === 1 ? "" : "s"} done today` : "Watching · nothing needed doing yet";

  return (
    <>
      <button type="button" className={`jo${on ? " on" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Open JARVIS">
        <Core />
        <span className="jo-text">
          <b>JARVIS</b>
          <span>{status}</span>
          {waiting > 0 && <span className="jo-wait">{waiting} waiting for you{recs.filter((r) => r.strength === "strong").length ? ` · ${recs.filter((r) => r.strength === "strong").length} strong emails ready` : ""}</span>}
          <span className="jo-ask">Ask me anything about {clientName} →</span>
        </span>
      </button>

      {open && createPortal(
        <div className="jo-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <aside className="jo-panel" role="dialog" aria-modal="true" aria-label="JARVIS">
            <header className="jo-head">
              <Core size={44} busy />
              <div className="min-w-0">
                <b>JARVIS</b>
                <span>{clientName} · {status}</span>
              </div>
              <Link href={`/jarvis?c=${clientId}`} className="jo-full" prefetch={false}>Full workspace <ArrowUpRight size={13} /></Link>
              <button type="button" className="jo-x" onClick={() => setOpen(false)} aria-label="Close JARVIS (Esc)"><X size={16} /></button>
            </header>
            {actions.length > 0 && (
              <section className="jo-did" aria-label="What JARVIS did">
                <h3>What I did recently</h3>
                <ul>{actions.map((a) => <li key={a.id} className={a.status}><span>{a.reason}</span><small>{a.status === "done" ? "done" : a.status} · {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></li>)}</ul>
              </section>
            )}
            {recs.length > 0 && <div className="jo-rec"><RecommendedApprovals clientId={clientId} items={recs} agreement={agreement} /></div>}
            <div className="jo-chat"><JarvisChat clientId={clientId} clientName={clientName} accountId={null} accountName={null} conversationId={null} initial={[]} /></div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
