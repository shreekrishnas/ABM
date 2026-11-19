"use client";
// What a section shows when one of its pages fails: the app around it keeps working.

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export function SectionError({ error, reset, back, label }: { error: Error & { digest?: string }; reset: () => void; back: string; label: string }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="glass-card-static page-enter se-box" role="alert">
      <AlertTriangle size={22} aria-hidden />
      <h2>This page couldn&apos;t load</h2>
      <p>{/budget/i.test(error.message) ? error.message : "Something went wrong on our side. Your data is safe. Try again, or go back to " + label + "."}</p>
      <div className="se-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={reset}><RotateCcw size={14} /> Try again</button>
        <Link href={back} className="btn btn-secondary btn-sm">Back to {label}</Link>
      </div>
      {error.digest && <small>Reference {error.digest}</small>}
    </div>
  );
}
