"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sampleStepAction } from "./actions";

/** Loads the Test client step by step, showing progress, so no single request runs long. */
export function SampleLoader({ label }: { label: string }) {
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const router = useRouter();
  const run = () =>
    start(async () => {
      for (let i = 0; i < 60; i++) {
        const r = await sampleStepAction();
        setMsg(r.ok ? r.message : `Stopped: ${r.message}`);
        if (r.done) break;
      }
      router.refresh();
    });
  return (
    <span className="inline-flex items-center gap-3 flex-wrap">
      <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={busy}>{busy ? "Loading…" : label}</button>
      {msg && <span className="muted text-xs" role="status">{msg}</span>}
    </span>
  );
}
