// v2 building blocks (docs/DESIGN.md): action-first rows, intent pill, stepper, hero.
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

export type IntentLevel = "hot" | "warm" | "cold";
const INTENT_VAR: Record<IntentLevel, string> = { hot: "var(--intent-hot)", warm: "var(--intent-warm)", cold: "var(--intent-cold)" };
const INTENT_WORD: Record<IntentLevel, string> = { hot: "Hot", warm: "Warm", cold: "Quiet" };

export function IntentPill({ level, score, title }: { level: IntentLevel; score?: number; title?: string }) {
  return (
    <span className="intent" title={title} style={{ ["--c" as string]: INTENT_VAR[level] }}>
      <span className="dot" />
      {INTENT_WORD[level]}{score != null && <span className="tnum" style={{ opacity: 0.75 }}>· {score}</span>}
    </span>
  );
}

export const FAMILY: Record<string, { label: string; color: string }> = {
  trigger: { label: "Trigger", color: "var(--fam-trigger)" },
  programme: { label: "Programme", color: "var(--fam-programme)" },
  leadership: { label: "New leader", color: "var(--fam-leadership)" },
  hiring: { label: "Hiring", color: "var(--fam-hiring)" },
  conversation: { label: "In conversation", color: "var(--fam-conversation)" },
  engagement: { label: "Engaged", color: "var(--fam-engagement)" },
  third_party: { label: "Intent data", color: "var(--fam-engagement)" },
  team_context: { label: "Team note", color: "var(--intent-cold)" },
  negative: { label: "Risk", color: "var(--fam-negative)" },
};

export function FamilyChip({ family }: { family: string }) {
  const f = FAMILY[family] ?? { label: family, color: "var(--intent-cold)" };
  return <span className="chip" style={{ ["--c" as string]: f.color }}>{f.label}</span>;
}

/** One thing that needs a person, with exactly one action. */
export function QueueRow({ href, rail, lead, title, sub, action, meta }: { href: string; rail?: string; lead?: ReactNode; title: ReactNode; sub?: ReactNode; action: string; meta?: ReactNode }) {
  return (
    <Link href={href} className="q-row" style={{ ["--rail" as string]: rail ?? "var(--accent-indigo)", gridTemplateColumns: lead ? "4px auto 1fr auto" : "4px 1fr auto" }}>
      <span className="q-rail" aria-hidden />
      {lead}
      <span className="min-w-0">
        <span className="q-title block">{title}</span>
        {sub && <span className="q-sub">{sub}</span>}
        {meta && <span className="mt-1.5 flex flex-wrap gap-1">{meta}</span>}
      </span>
      <span className="q-act">{action}<ArrowRight size={14} strokeWidth={2.4} /></span>
    </Link>
  );
}

export function SectionLabel({ children, count, action }: { children: ReactNode; count?: number; action?: ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>{count != null && <span className="n">{count}</span>}
      {action && <span className="order-last normal-case tracking-normal">{action}</span>}
    </div>
  );
}

export function Stepper({ steps, reached, current }: { steps: readonly string[]; reached: Record<string, boolean>; current: string }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((s, i) => {
        const here = s === current;
        const done = reached[s] && !here;
        return (
          <li key={s} className="flex items-center">
            <span className={`s${done ? " done" : ""}${here ? " here" : ""}`} aria-current={here ? "step" : undefined}>
              <span className="b">{done && <Check size={11} strokeWidth={3} />}</span>{s}
            </span>
            {i < steps.length - 1 && <span className={`line${reached[steps[i + 1]] ? " done" : ""}`} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function NextAction({ text, why, children }: { text: string; why?: ReactNode; children?: ReactNode }) {
  return (
    <div className="next-action">
      <div className="min-w-0">
        <div className="label">Next best action</div>
        <div className="text">{text}</div>
        {why && <div className="secondary mt-1 text-xs">{why}</div>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function StatStrip({ items }: { items: { label: string; value: ReactNode; meta?: ReactNode }[] }) {
  return (
    <div className="stat-strip">
      {items.map((i) => (
        <div key={i.label}>
          <div className="micro">{i.label}</div>
          <div className="v">{i.value}</div>
          {i.meta && <div className="m">{i.meta}</div>}
        </div>
      ))}
    </div>
  );
}
