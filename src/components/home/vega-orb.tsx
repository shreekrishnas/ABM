"use client";
// Vega on Home: a live animated core you click to talk to it. Opens a panel on the same page
// with the conversation and what Vega did today; the full workspace stays one link away.

import { useCallback, useEffect, useState } from "react";
import { RecommendedApprovals, type RecItem } from "@/app/vega/approvals";
import { Core, VEGA_OPEN_EVENT, VegaPanel } from "@/components/vega/panel";

export interface OrbAction { id: string; reason: string; status: string; at: string }

export function VegaOrb({ clientId, clientName, doneToday, waiting, actions, on, recs = [], agreement = { decisions: 0, agreedShare: null } }: { clientId: string; clientName: string; doneToday: number; waiting: number; actions: OrbAction[]; on: boolean; recs?: RecItem[]; agreement?: { decisions: number; agreedShare: number | null } }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  // Ctrl/Cmd + J on Home opens this same panel.
  useEffect(() => { window.addEventListener(VEGA_OPEN_EVENT, show); return () => window.removeEventListener(VEGA_OPEN_EVENT, show); }, [show]);

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

      {open && (
        <VegaPanel clientId={clientId} clientName={clientName} status={status} onClose={close} extra={<>
          {actions.length > 0 && (
            <section className="jo-did" aria-label="What Vega did">
              <h3>What I did recently</h3>
              <ul>{actions.map((a) => <li key={a.id} className={a.status}><span>{a.reason}</span><small>{a.status === "done" ? "done" : a.status} · {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></li>)}</ul>
            </section>
          )}
          {recs.length > 0 && <div className="jo-rec"><RecommendedApprovals items={recs} agreement={agreement} /></div>}
        </>} />
      )}
    </>
  );
}
