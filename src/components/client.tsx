"use client";

import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import type { ActionState } from "@/app/actions";

function Toast({ state, onClose }: { state: ActionState; onClose: () => void }) {
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [state, onClose]);
  if (!state) return null;
  return (
    <div role="status" className="animate-scale-in fixed bottom-6 right-6 z-[200] flex max-w-md items-start gap-2.5 rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--surface-card-elevated)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-hover)", color: "var(--text-primary)" }}>
      {state.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" style={{ color: "var(--status-success)" }} /> : <XCircle size={18} className="mt-0.5 shrink-0" style={{ color: "var(--status-danger)" }} />}
      <span className="flex-1">{state.message}</span>
      <button onClick={onClose} className="btn-icon btn -m-1 h-7 w-7" aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}

/** Button that runs a bound server action and shows the result as a toast. */
export function ActionButton({ action, children, className = "btn btn-secondary", confirm, title, disabled }: { action: () => Promise<ActionState>; children: ReactNode; className?: string; confirm?: string; title?: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <>
      <button
        className={className}
        disabled={pending || disabled}
        title={title}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setState(await action()));
        }}
      >
        {pending ? <Loader2 size={15} className="spin" /> : null}
        {children}
      </button>
      <Toast state={state} onClose={() => setState(null)} />
    </>
  );
}

/** Form wired to a server action with useActionState; shows the result as a toast. */
export function ActionForm({ action, children, className, resetOnSuccess = true }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; children: ReactNode; className?: string; resetOnSuccess?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const [shown, setShown] = useState<ActionState>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!state) return;
    setShown(state);
    if (state.ok && resetOnSuccess) setKey((k) => k + 1);
  }, [state, resetOnSuccess]);
  return (
    <>
      <form key={key} action={formAction} className={className}>
        {children}
      </form>
      <Toast state={shown} onClose={() => setShown(null)} />
    </>
  );
}

export function SubmitButton({ children, className = "btn btn-primary", name, value }: { children: ReactNode; className?: string; name?: string; value?: string }) {
  return (
    <PendingAware>
      {(pending) => (
        <button type="submit" className={className} disabled={pending} name={name} value={value}>
          {pending && <Loader2 size={15} className="spin" />}
          {children}
        </button>
      )}
    </PendingAware>
  );
}

function PendingAware({ children }: { children: (pending: boolean) => ReactNode }) {
  const { pending } = useFormStatus();
  return <>{children(pending)}</>;
}

/** Glass modal opened by a trigger button. */
export function Modal({ trigger, title, eyebrow, children, triggerClass = "btn btn-primary" }: { trigger: ReactNode; title: string; eyebrow?: string; children: (close: () => void) => ReactNode; triggerClass?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button className={triggerClass} onClick={() => setOpen(true)}>{trigger}</button>
      {open && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="glass-modal" role="dialog" aria-modal="true" aria-label={title}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
                <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{title}</h2>
              </div>
              <button className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            {children(() => setOpen(false))}
          </div>
        </div>
      )}
    </>
  );
}
