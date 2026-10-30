"use client";

import { useTransition } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { moveOpportunityAction } from "@/app/actions";

const STAGES = ["discovery", "qualification", "proposal", "negotiation", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];
const LABEL: Record<Stage, string> = { discovery: "Discovery", qualification: "Qualification", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost" };

/** One click to the next stage; any other stage from a small menu. Closed-lost asks for a reason. */
export function OppMover({ id, stage }: { id: string; stage: string }) {
  const [pending, start] = useTransition();
  const i = STAGES.indexOf(stage as Stage);
  const next = i >= 0 && i < 3 ? STAGES[i + 1] : stage === "negotiation" ? "won" : null;
  const move = (to: Stage) => {
    let reason: string | undefined;
    if (to === "lost") {
      reason = window.prompt("Why was it lost? (helps the learning loop)") ?? undefined;
      if (reason === undefined) return;
    }
    start(async () => {
      await moveOpportunityAction(id, to, reason);
    });
  };
  return (
    <div className="op-move">
      {next && (
        <button type="button" className="btn btn-secondary btn-sm op-next" disabled={pending} onClick={() => move(next)}>
          {pending ? <Loader2 size={13} className="spin" /> : null}
          {next === "won" ? "Close won" : `Next: ${LABEL[next]}`} <ArrowRight size={13} aria-hidden />
        </button>
      )}
      <select aria-label="Move to another stage" className="glass-select op-other" value="" disabled={pending} onChange={(e) => e.target.value && move(e.target.value as Stage)}>
        <option value="">Move…</option>
        {STAGES.filter((s) => s !== stage && s !== next).map((s) => <option key={s} value={s}>{s === "won" ? "Close won" : s === "lost" ? "Close lost" : LABEL[s]}</option>)}
      </select>
    </div>
  );
}
