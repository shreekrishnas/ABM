"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { reviewLabel } from "@/lib/review-labels";
import { Badge } from "./badge";
import { useUndo } from "./undo";

export interface DecisionAction { label: string; kind?: "primary" | "secondary" | "danger"; run: () => Promise<unknown> | unknown; done: string }

/**
 * A decision a person has to make. Variants: a queue row (Today), a list item (Decisions) and a
 * banner on the record itself. Acting dims the card with its outcome; the action waits behind Undo.
 */
export function DecisionCard({ type, title, context, href, actions = [], variant = "list", notInspected }: {
  type: string; title: string; context?: ReactNode; href?: string; actions?: DecisionAction[]; variant?: "queue" | "list" | "banner"; notInspected?: boolean;
}) {
  const hold = useUndo();
  const [outcome, setOutcome] = useState<string | null>(null);
  return (
    <article className={`k-dc ${variant}${outcome ? " done" : ""}`}>
      <div className="k-dc-main">
        <Badge tone={type === "possible_blocker" || type === "bounce_breaker" ? "danger" : type === "draft_approval" ? "accent" : "warning"}>{reviewLabel(type)}</Badge>
        {href ? <Link href={href} className="k-dc-title">{title}</Link> : <b className="k-dc-title">{title}</b>}
        {context && <div className="k-dc-ctx">{context}</div>}
        {notInspected && <span className="k-dc-ctx">Details not inspected yet.</span>}
      </div>
      <div className="k-dc-actions">
        {outcome ? <span className="k-dc-outcome">{outcome}</span> : actions.map((a) => (
          <button key={a.label} type="button" className={`btn btn-sm ${a.kind === "primary" ? "btn-primary" : a.kind === "danger" ? "btn-danger" : "btn-secondary"}`}
            onClick={() => { setOutcome(a.done); hold(`${a.done}: ${title}`, async () => { await a.run(); }, () => setOutcome(null)); }}>
            {a.label}
          </button>
        ))}
      </div>
    </article>
  );
}
