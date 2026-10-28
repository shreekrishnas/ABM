"use client";

import { useId, type ReactElement, type ReactNode } from "react";
import { cloneElement } from "react";

/** Label tied to its control (for/id), hint and error linked for screen readers, "Required" as text. */
export function FormField({ label, hint, error, required, children }: { label: string; hint?: ReactNode; error?: string; required?: boolean; children: ReactElement<Record<string, unknown>> }) {
  const id = useId();
  const hintId = hint ? `${id}-h` : undefined;
  const errId = error ? `${id}-e` : undefined;
  const control = cloneElement(children, { id, "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined, "aria-required": required || undefined });
  return (
    <div className={`k-field${error ? " invalid" : ""}`}>
      <label htmlFor={id}>{label}{required && <span className="k-req">Required</span>}</label>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
      {error && <small id={errId} className="k-err">{error}</small>}
    </div>
  );
}

/** Appears while there are unsaved changes; says which sections changed. */
export function StickySaveBar({ changed, saving, onSave, onDiscard, status }: { changed: string[]; saving?: boolean; onSave: () => void; onDiscard: () => void; status?: string }) {
  if (!changed.length && !status) return null;
  return (
    <div className="k-savebar" role="region" aria-label="Unsaved changes">
      <span>{changed.length ? <>Unsaved changes in <b>{changed.join(", ")}</b></> : status}</span>
      {changed.length > 0 && (
        <span className="k-savebar-a">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard} disabled={saving}>Discard</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </span>
      )}
    </div>
  );
}
