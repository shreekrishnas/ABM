"use client";

// Background jobs in the top bar: a spinner with a count while something runs, a panel listing
// today's jobs, and a short message when one finishes. Reads a plain route (not a server action),
// so checking never holds up moving around the app.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { toast } from "@/components/client";

interface Job { id: string; label: string; client: string; status: string; message: string | null; href: string | null; createdAt: string; finishedAt: string | null }

const since = (iso: string, end?: string | null) => {
  const s = Math.max(0, Math.round(((end ? new Date(end).getTime() : Date.now()) - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export function JobsIndicator() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const announced = useRef<Set<string> | null>(null);
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/jobs/mine", { cache: "no-store" });
      if (!r.ok) return;
      const { jobs: next } = (await r.json()) as { jobs: Job[] };
      // Announce each job that finished since this tab opened the app, once, even across reloads.
      let since = "";
      try {
        since = sessionStorage.getItem("abm:jobs-since") ?? "";
        if (!since) sessionStorage.setItem("abm:jobs-since", (since = new Date().toISOString()));
        if (!announced.current) announced.current = new Set(JSON.parse(sessionStorage.getItem("abm:jobs-announced") ?? "[]") as string[]);
      } catch {
        announced.current ??= new Set();
      }
      let finished = false;
      for (const j of next) {
        if ((j.status === "done" || j.status === "failed") && !announced.current!.has(j.id) && (!since || j.createdAt >= since)) {
          announced.current!.add(j.id);
          finished = true;
          toast({ ok: j.status === "done", message: j.message ?? j.label });
        }
      }
      if (finished) {
        try { sessionStorage.setItem("abm:jobs-announced", JSON.stringify([...announced.current!].slice(-50))); } catch {}
        router.refresh();
      }
      setJobs(next);
    } catch {
      /* offline: try again next time */
    }
  }, [router]);

  // Every 4 s while something runs, otherwise every 30 s; at once after any button reports back.
  useEffect(() => {
    load();
    const t = setInterval(load, running.length ? 4_000 : 30_000);
    return () => clearInterval(t);
  }, [load, running.length]);
  useEffect(() => {
    const on = () => setTimeout(load, 600);
    window.addEventListener("abm:toast", on);
    return () => window.removeEventListener("abm:toast", on);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);

  if (!jobs.length) return null;
  return (
    <>
      <button type="button" className="nav-icon nb-btn" onClick={() => { setOpen(true); load(); }} aria-label={running.length ? `${running.length} running in the background` : "Background jobs"} title={running.length ? `${running.length} running in the background` : "Background jobs today"}>
        {running.length ? <Loader2 size={17} strokeWidth={1.75} className="spin" /> : <CheckCircle2 size={17} strokeWidth={1.75} />}
        {running.length > 0 && <span className="nav-dotcount tnum">{running.length}</span>}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="nb-scrim" onMouseDown={() => setOpen(false)} />
          <aside className="nb-panel" role="dialog" aria-label="Background jobs">
            <header className="nb-head"><h2>Running in the background</h2><button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button></header>
            <p className="nb-empty">Long tasks keep going while you work elsewhere or switch client.</p>
            <div className="nb-list">
              {jobs.map((j) => {
                const live = j.status === "running" || j.status === "queued";
                const Icon = live ? Loader2 : j.status === "done" ? CheckCircle2 : XCircle;
                const body = (
                  <>
                    <span className={`nb-ic ${live ? "info" : j.status === "done" ? "ok" : "bad"}`}><Icon size={15} className={live ? "spin" : undefined} /></span>
                    <span className="nb-t"><b>{j.label}</b><small>{live ? `Running · ${since(j.createdAt)}` : j.message ?? (j.status === "done" ? "Done" : "Stopped")} · {j.client}</small></span>
                    <span className="nb-at">{live ? "" : j.href ? "Open" : since(j.createdAt, j.finishedAt)}</span>
                  </>
                );
                return j.href && !live
                  ? <Link key={j.id} href={j.href} className="nb-item" onClick={() => setOpen(false)}>{body}</Link>
                  : <div key={j.id} className="nb-item">{body}</div>;
              })}
            </div>
          </aside>
        </>,
        document.body,
      )}
    </>
  );
}
