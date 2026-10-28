import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/** Status always carries text; colour only reinforces it. */
export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return <span className={`k-badge ${tone}`}>{icon}{children}</span>;
}

const CONF: Record<string, { tone: Tone; label: string; Icon: typeof Info }> = {
  verified: { tone: "success", label: "Verified", Icon: CheckCircle2 },
  probable: { tone: "warning", label: "Single source", Icon: AlertTriangle },
  conflicting: { tone: "danger", label: "Disputed", Icon: XCircle },
  stale: { tone: "neutral", label: "Dated", Icon: CircleDashed },
  unknown: { tone: "neutral", label: "Unchecked", Icon: CircleDashed },
  invalid: { tone: "danger", label: "Wrong", Icon: XCircle },
};

/** How sure we are of a fact: icon + word + colour, never colour alone. */
export function ConfidenceTag({ status }: { status: string }) {
  const c = CONF[status] ?? CONF.unknown;
  return <Badge tone={c.tone} icon={<c.Icon size={12} aria-hidden />}>{c.label}</Badge>;
}
