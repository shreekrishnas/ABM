import { Check } from "lucide-react";

/** Where a company is in the whole flow — the same steps on every screen. */
export const FLOW_STEPS = ["Added", "Researched", "Drafted", "Emailing", "Engaged", "Hand-off"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export function accountStep(a: { pipelineStage: number; stage: string; disqualifyReason?: string | null }, x: { drafts: number; handoff: boolean }): FlowStep {
  if (x.handoff || a.stage === "MQA" || a.stage === "OPPORTUNITY" || a.stage === "CUSTOMER") return "Hand-off";
  if (a.stage === "ENGAGED") return "Engaged";
  if (a.stage === "AWARE") return "Emailing";
  if (x.drafts > 0 || a.pipelineStage >= 11) return "Drafted";
  if (a.pipelineStage >= 7) return "Researched";
  return "Added";
}

export function PipelineStepper({ current, stopped }: { current: FlowStep; stopped?: string | null }) {
  const at = FLOW_STEPS.indexOf(current);
  return (
    <ol className="flow-stepper" aria-label={`Progress: ${current}`}>
      {FLOW_STEPS.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? (stopped ? "stopped" : "now") : ""} title={i === at && stopped ? stopped : s}>
          <span className="dot">{i < at ? <Check size={10} strokeWidth={3} /> : null}</span>
          <span className="lbl">{s}</span>
        </li>
      ))}
    </ol>
  );
}
