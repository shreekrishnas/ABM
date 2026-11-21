// Shared (not a client component): from a Server Component it runs on the server, where its
// children are plain elements and cloning them is safe. A client-only FormField cloned children
// that crossed the server/client boundary as lazy references, which rendered as an invalid
// element and crashed Approvals on email drafts.
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
