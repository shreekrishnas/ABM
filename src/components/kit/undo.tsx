"use client";

// Undo without backend changes: the action is held for a few seconds while a toast offers Undo;
// only if nobody undoes it is it actually sent. One toast at a time, newest wins.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Pending = { id: number; label: string; run: () => Promise<unknown> | unknown; until: number; onUndo?: () => void };
type Hold = (label: string, run: Pending["run"], onUndo?: () => void) => void;
const Ctx = createContext<{ hold: Hold } | null>(null);
export const UNDO_MS = 8000;

export function UndoProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async (x: Pending | null) => { if (x) await x.run(); }, []);
  const hold = useCallback<Hold>((label, run, onUndo) => {
    setP((prev) => {
      if (timer.current) clearTimeout(timer.current);
      void flush(prev); // a new action sends the previous one now
      const next = { id: Date.now(), label, run, onUndo, until: Date.now() + UNDO_MS };
      timer.current = setTimeout(() => { setP(null); void flush(next); }, UNDO_MS);
      return next;
    });
  }, [flush]);
  // Leaving the page sends anything still held, so nothing is silently lost.
  useEffect(() => { const f = () => { if (p) void p.run(); }; window.addEventListener("pagehide", f); return () => window.removeEventListener("pagehide", f); }, [p]);
  return (
    <Ctx.Provider value={{ hold }}>
      {children}
      {p && <Toast key={p.id} label={p.label} until={p.until} onUndo={() => { if (timer.current) clearTimeout(timer.current); p.onUndo?.(); setP(null); }} />}
    </Ctx.Provider>
  );
}

function Toast({ label, until, onUndo }: { label: string; until: number; onUndo: () => void }) {
  const [left, setLeft] = useState(Math.ceil((until - Date.now()) / 1000));
  useEffect(() => { const t = setInterval(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 250); return () => clearInterval(t); }, [until]);
  return (
    <div className="k-toast" role="status" aria-live="polite">
      <span>{label}</span>
      <button type="button" className="k-toast-undo" onClick={onUndo}>Undo <span className="tnum">({left}s)</span></button>
    </div>
  );
}

/** Hold an action behind an Undo toast. Falls back to running it straight away outside a provider. */
export function useUndo() {
  const c = useContext(Ctx);
  return c?.hold ?? (((_label, run) => void run()) as Hold);
}
