"use client";
// One Vega, everywhere: the same side panel opens from the core on Home, from the Vega button on
// every other page, and with Ctrl/Cmd + J. It knows the company behind the page (a company page,
// a person's page, an item open in Approvals), keeps your recent conversations, and links to the
// full workspace at /vega. Everything goes through the same Vega actions and checks.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, History, X } from "lucide-react";
import { VegaChat } from "@/app/vega/chat";
import { listVegaConversations, loadVegaConversation, vegaFocus, type VegaMessage } from "@/app/vega/actions";

export const VEGA_OPEN_EVENT = "vega:open";

/** The Vega core: a dark device with a tick bezel, a sweeping scan, counter-rotating rings and a glowing centre. */
export function Core({ size = 48, busy = false, live = false }: { size?: number; busy?: boolean; live?: boolean }) {
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

type Focus = { accountId: string; accountName: string; from: "company" | "person" | "approval" } | null;
const FROM = { company: "this company", person: "this person's company", approval: "the company in this approval" } as const;

/** The panel itself. `extra` is what the opener adds above the conversation (Home: what Vega did, emails to review). */
export function VegaPanel({ clientId, clientName, status, extra, onClose }: { clientId: string; clientName: string; status?: string; extra?: ReactNode; onClose: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const [focus, setFocus] = useState<Focus>(null);
  const [useFocus, setUseFocus] = useState(true);
  const [history, setHistory] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [thread, setThread] = useState<{ id: string | null; messages: VegaMessage[] }>({ id: null, messages: [] });
  const [linkConv, setLinkConv] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);
  useEffect(() => {
    vegaFocus(clientId, path, params.get("pick"), params.get("peek")).then(setFocus).catch(() => setFocus(null));
    listVegaConversations(clientId).then(setHistory).catch(() => setHistory([]));
  }, [clientId, path, params]);

  const openThread = async (id: string) => {
    const messages = await loadVegaConversation(clientId, id).catch(() => null);
    if (messages) { setThread({ id, messages }); setLinkConv(id); setShowHistory(false); }
  };
  const active = useFocus ? focus : null;
  const full = `/vega?${new URLSearchParams({ c: clientId, ...(active ? { a: active.accountId } : {}), ...(linkConv ? { conv: linkConv } : {}) })}`;

  return createPortal(
    <div className="jo-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="jo-panel" role="dialog" aria-modal="true" aria-label="Vega">
        <header className="jo-head">
          <Core size={40} busy />
          <div className="min-w-0">
            <b>Vega</b>
            <span>{clientName}{status ? ` · ${status}` : ""}</span>
          </div>
          <button type="button" className="jo-hist" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} aria-label="Earlier conversations" title="Earlier conversations"><History size={15} /></button>
          <Link href={full} className="jo-full" prefetch={false}>Full workspace <ArrowUpRight size={13} /></Link>
          <button type="button" className="jo-x" onClick={onClose} aria-label="Close Vega (Esc)"><X size={16} /></button>
        </header>
        {focus && (
          <p className="jo-focus">
            {useFocus ? <>Answers about <b>{focus.accountName}</b> ({FROM[focus.from]}).</> : <>Answers about all of {clientName}.</>}{" "}
            <button type="button" className="jo-focus-x" onClick={() => setUseFocus((v) => !v)}>{useFocus ? "Ask about everything instead" : `Focus on ${focus.accountName}`}</button>
          </p>
        )}
        {showHistory && (
          <nav className="jo-history" aria-label="Earlier conversations">
            <button type="button" onClick={() => { setThread({ id: null, messages: [] }); setLinkConv(null); setShowHistory(false); }}>New conversation</button>
            {history.length === 0 ? <span className="muted text-xs">No earlier conversations for {clientName}.</span> : history.map((h) => (
              <button key={h.id} type="button" onClick={() => openThread(h.id)} aria-current={thread.id === h.id ? "true" : undefined}>
                <span>{h.title}</span><small>{new Date(h.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small>
              </button>
            ))}
          </nav>
        )}
        {extra}
        <div className="jo-chat">
          <VegaChat key={`${thread.id ?? "new"}-${active?.accountId ?? "all"}`} clientId={clientId} clientName={clientName} accountId={active?.accountId ?? null} accountName={active?.accountName ?? null} conversationId={thread.id} initial={thread.messages} embedded onConversation={setLinkConv} />
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * The Vega button on every page except Home (Home has the core) and /vega itself. Super Admins
 * covering the client only, the same rule as everything else in Vega.
 */
export function VegaLauncher({ clientId, clientName }: { clientId: string; clientName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const here = path !== "/" && !path.startsWith("/vega");
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!here) return;
    window.addEventListener(VEGA_OPEN_EVENT, show);
    return () => window.removeEventListener(VEGA_OPEN_EVENT, show);
  }, [here, show]);
  if (!here) return null;
  return (
    <>
      <button type="button" className="vg-fab" onClick={show} aria-haspopup="dialog" aria-label={`Ask Vega about ${clientName} (Ctrl or Cmd + J)`} title="Ask Vega (Ctrl/Cmd + J)">
        <Core size={34} />
      </button>
      {open && <VegaPanel clientId={clientId} clientName={clientName} onClose={close} />}
    </>
  );
}
