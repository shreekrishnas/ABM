// Level 3 in the interface: Vega's ranked view of the emails waiting for approval, with its
// recommendation and reasons. The decision itself is made in Approvals (one workspace for every
// approval), so each email opens there; Vega approves nothing from this list.

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface RecItem { draftId: string; reviewId: string | null; person: string; company: string; subject: string; strength: "strong" | "fair" | "weak"; recommendation: "approve" | "edit" | "reject"; reasons: string[]; waitingDays: number }

const WORD = { strong: "Strong · approve", fair: "Fair · worth an edit", weak: "Weak · fix or reject" } as const;

/** The email's own item in Approvals (falls back to the list of emails to approve). */
export const reviewHref = (i: Pick<RecItem, "reviewId">) => (i.reviewId ? `/review?type=draft_approval&pick=${i.reviewId}` : "/review?type=draft_approval");

export function RecommendedApprovals({ items, agreement }: { clientId?: string; items: RecItem[]; agreement: { decisions: number; agreedShare: number | null } }) {
  if (!items.length) return <div className="jv-card"><div className="jv-card-h"><h2>Emails to approve</h2></div><p className="muted text-xs">Nothing waiting. New drafts appear here with Vega&apos;s recommendation.</p></div>;
  const first = items.find((i) => i.strength === "strong") ?? items[0];
  return (
    <div className="jv-card jv-rec">
      <div className="jv-card-h">
        <h2>Emails to approve</h2>
        <span className="muted text-xs">{items.length} waiting{agreement.decisions >= 5 && agreement.agreedShare != null ? ` · you agreed with Vega ${Math.round(agreement.agreedShare * 100)}% of ${agreement.decisions} times` : ""}</span>
      </div>
      <ul className="jv-rec-list">
        {items.map((i) => (
          <li key={i.draftId} className={i.strength}>
            <span className="jv-rec-gap" aria-hidden />
            <div className="min-w-0">
              <div className="jv-rec-top"><b>{i.person}</b><span className="muted"> · {i.company}</span><span className={`jv-str ${i.strength}`}>{WORD[i.strength]}</span></div>
              <div className="jv-rec-subj">{i.subject}</div>
              <div className="jv-rec-why">{i.reasons.slice(0, 3).join(" · ")}{i.waitingDays ? ` · waiting ${i.waitingDays}d` : ""}</div>
            </div>
            <Link prefetch={false} href={reviewHref(i)} className="jv-rec-open" aria-label={`Review the email to ${i.person} in Approvals`}>Review</Link>
          </li>
        ))}
      </ul>
      <div className="jv-rec-foot">
        <Link prefetch={false} href={reviewHref(first)} className="btn btn-primary btn-sm">Review in Approvals <ArrowRight size={13} /></Link>
        <span className="muted text-xs">Approve, edit or reject each email in Approvals. It opens on {first.strength === "strong" ? "the strongest" : "the first"} one and moves to the next after each decision.</span>
      </div>
    </div>
  );
}
