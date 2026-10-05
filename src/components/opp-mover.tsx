"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { moveOpportunityAction } from "@/app/actions";

const STAGES = ["discovery", "qualification", "proposal", "negotiation", "won", "lost"] as const;

/** Stage picker on an opportunity card; asks for a reason on closed-lost. */
export function OppMover({ id, stage }: { id: string; stage: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(stage);
  return (
    <div className="relative mt-2 min-w-0">
      <select
        aria-label="Move stage"
        className="glass-select text-xs"
        style={{ height: 32, paddingTop: 0, paddingBottom: 0, fontSize: "0.75rem" }}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as (typeof STAGES)[number];
          let reason: string | undefined;
          if (next === "lost") {
            reason = window.prompt("Why was it lost? (helps the learning loop)") ?? undefined;
            if (reason === undefined) return;
          }
          setValue(next);
          start(async () => {
            await moveOpportunityAction(id, next, reason);
          });
        }}
      >
        {STAGES.map((s) => <option key={s} value={s}>{s === "won" ? "Close won" : s === "lost" ? "Close lost" : `Move to ${s}`}</option>)}
      </select>
      {pending && <Loader2 size={13} className="spin absolute right-8 top-2" />}
    </div>
  );
}
