"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RotateCcw } from "lucide-react";

export function Skeleton({ w = "100%", h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="k-sk" style={{ width: w, height: h, borderRadius: r }} aria-hidden />;
}

/** A panel's loading state: lines shaped like what is coming. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return <div className="k-skrows" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} w={`${90 - (i % 3) * 15}%`} />)}</div>;
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="k-empty">
      <span className="k-empty-i" aria-hidden>{icon ?? <Inbox size={20} />}</span>
      <b>{title}</b>
      {text && <span>{text}</span>}
      {action}
    </div>
  );
}

type Variant = "error" | "partial" | "stale" | "offline" | "denied";
const COPY: Record<Variant, string> = {
  error: "This couldn't be loaded.",
  partial: "Some steps failed; what's shown is what finished.",
  stale: "This was last updated more than a day ago.",
  offline: "You're offline. Showing what was loaded before.",
  denied: "You don't have access to this. Ask a Super Admin.",
};

/** One banner for every not-quite-right state, with a retry where retrying helps. */
export function ErrorBanner({ variant = "error", detail, onRetry }: { variant?: Variant; detail?: ReactNode; onRetry?: () => void }) {
  return (
    <div className={`k-banner ${variant}`} role={variant === "error" ? "alert" : "status"}>
      <AlertTriangle size={16} aria-hidden />
      <span><b>{COPY[variant]}</b>{detail && <> {detail}</>}</span>
      {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}><RotateCcw size={13} /> Retry</button>}
    </div>
  );
}
