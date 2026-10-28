"use client";

// One-click decisions wait 8 seconds behind Undo before the server action runs.
// J / K move through the list; the shortcuts are listed in the pane.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useUndo } from "@/components/kit";

type Result = { ok: boolean; message: string } | null;

export function DecideButton({ action, label, done, kind = "secondary", next }: { action: () => Promise<Result>; label: React.ReactNode; done: string; kind?: "primary" | "secondary" | "danger" | "ghost"; next?: string }) {
  const hold = useUndo();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "held" | "sent">("idle");
  const [, start] = useTransition();
  if (state !== "idle") return <span className="dz-outcome">{done}</span>;
  return (
    <button type="button" className={`btn btn-sm btn-${kind}`} onClick={() => {
      setState("held");
      hold(done, async () => { const r = await action(); setState("sent"); start(() => router.refresh()); return r; }, () => setState("idle"));
      if (next) router.replace(next, { scroll: false });
    }}>{label}</button>
  );
}

/** J / K (and arrow keys) move to the next / previous decision. */
export function KeyNav({ prev, next }: { prev?: string; next?: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "j" || e.key === "ArrowDown") && next) { e.preventDefault(); router.replace(next, { scroll: false }); }
      if ((e.key === "k" || e.key === "ArrowUp") && prev) { e.preventDefault(); router.replace(prev, { scroll: false }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);
  return null;
}
