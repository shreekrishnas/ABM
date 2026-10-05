"use client";

import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import type { ActionState } from "@/app/actions";

/** Show a toast from anywhere; rendered by <ToastHost /> in the root layout so it survives re-renders. */
export function toast(state: ActionState) {
  if (state) window.dispatchEvent(new CustomEvent("abm:toast", { detail: state }));
}

export function ToastHost() {
  const [state, setState] = useState<ActionState>(null);
  useEffect(() => {
    const on = (e: Event) => setState({ ...(e as CustomEvent<NonNullable<ActionState>>).detail });
    window.addEventListener("abm:toast", on);
    return () => window.removeEventListener("abm:toast", on);
  }, []);
  return <Toast state={state} onClose={() => setState(null)} />;
}

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
  return (
    <>
      <button
        className={className}
        disabled={pending || disabled}
        title={title}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => toast(await action()));
        }}
      >
        {pending ? <Loader2 size={15} className="spin" /> : null}
        {children}
      </button>
    </>
  );
}

/** Form wired to a server action with useActionState; shows the result as a toast. */
export function ActionForm({ action, children, className, resetOnSuccess = true }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; children: ReactNode; className?: string; resetOnSuccess?: boolean }) {
  // Toast as soon as the action resolves: the form itself may unmount in the
  // same render (e.g. an approved draft leaves the queue).
  const [state, formAction] = useActionState(async (s: ActionState, fd: FormData) => {
    const r = await action(s, fd);
    toast(r);
    return r;
  }, null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!state) return;
    if (state.ok) window.dispatchEvent(new Event("abm:form-success"));
    if (state.ok && resetOnSuccess) setKey((k) => k + 1);
  }, [state, resetOnSuccess]);
  return (
    <>
      <form key={key} action={formAction} className={className}>
        {children}
      </form>
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
export function Modal({ trigger, title, eyebrow, children, triggerClass = "btn btn-primary" }: { trigger: ReactNode; title: string; eyebrow?: string; children: ReactNode; triggerClass?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // A successful ActionForm inside the modal closes it.
    const onSuccess = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("abm:form-success", onSuccess);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("abm:form-success", onSuccess);
    };
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
            {children}
          </div>
        </div>
      )}
    </>
  );
}
