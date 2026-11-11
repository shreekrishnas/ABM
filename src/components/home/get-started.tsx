"use client";

import Link from "next/link";
import { useTransition } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import { dismissHintAction } from "@/app/me/actions";

/** First-time checklist on Home: what to do to get the first emails out. */
export function GetStarted({ steps, left }: { steps: { label: string; done: boolean; href: string }[]; left: number }) {
  const [busy, start] = useTransition();
  return (
    <section className="gs" aria-label="Get started">
      <div className="gs-head">
        <div><b>Get started</b><span>{left} step{left === 1 ? "" : "s"} to your first approved email</span></div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Hide this" title="Hide" disabled={busy} onClick={() => start(() => dismissHintAction("get-started"))}><X size={15} /></button>
      </div>
      <ol className="gs-steps">
        {steps.map((s, i) => (
          <li key={s.label} className={s.done ? "done" : undefined}>
            {s.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
            <span>{i + 1}. {s.label}</span>
            {!s.done && <Link href={s.href} className="vz-link">Do this ›</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
