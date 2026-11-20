"use client";
// Level 3 in the interface: JARVIS's ranked list of emails waiting for approval. Strong ones are
// ticked for you; nothing happens until you confirm. Weak ones open in Approvals instead.

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { approveDrafts } from "./actions";

export interface RecItem { draftId: string; reviewId: string | null; person: string; company: string; subject: string; strength: "strong" | "fair" | "weak"; recommendation: "approve" | "edit" | "reject"; reasons: string[]; waitingDays: number }

const WORD = { strong: "Strong · approve", fair: "Fair · worth an edit", weak: "Weak · fix or reject" } as const;

export function RecommendedApprovals({ clientId, items, agreement }: { clientId: string; items: RecItem[]; agreement: { decisions: number; agreedShare: number | null } }) {
  const [picked, setPicked] = useState<string[]>(items.filter((i) => i.strength === "strong").slice(0, 25).map((i) => i.draftId));
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!items.length) return <div className="jv-card"><div className="jv-card-h"><h2>Emails to approve</h2></div><p className="muted text-xs">Nothing waiting. New drafts appear here with JARVIS&apos;s recommendation.</p></div>;

  const go = () => start(async () => {
    const r = await approveDrafts(clientId, picked);
    setMsg(r.message);
    setFailed(Object.fromEntries(r.results.filter((x) => !x.ok).map((x) => [x.draftId, x.message])));
    setConfirm(false);
    setPicked([]);
    router.refresh();
  });

  return (
    <div className="jv-card jv-rec">
      <div className="jv-card-h">
        <h2>Emails to approve</h2>
        <span className="muted text-xs">{items.length} waiting{agreement.decisions >= 5 && agreement.agreedShare != null ? ` · you agreed with JARVIS ${Math.round(agreement.agreedShare * 100)}% of ${agreement.decisions} times` : ""}</span>
      </div>
      <ul className="jv-rec-list">
        {items.map((i) => (
          <li key={i.draftId} className={i.strength}>
            {i.strength !== "weak" ? (
              <input type="checkbox" aria-label={`Approve the email to ${i.person}`} checked={picked.includes(i.draftId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.draftId].slice(0, 25) : p.filter((x) => x !== i.draftId)))} disabled={pending} />
            ) : <span className="jv-rec-gap" aria-hidden />}
            <div className="min-w-0">
              <div className="jv-rec-top"><b>{i.person}</b><span className="muted"> · {i.company}</span><span className={`jv-str ${i.strength}`}>{WORD[i.strength]}</span></div>
              <div className="jv-rec-subj">{i.subject}</div>
              <div className="jv-rec-why">{i.reasons.slice(0, 3).join(" · ")}{i.waitingDays ? ` · waiting ${i.waitingDays}d` : ""}</div>
              {failed[i.draftId] && <div className="jv-rec-fail">Not approved: {failed[i.draftId]}</div>}
            </div>
            <Link prefetch={false} href={i.reviewId ? `/review?pick=${i.reviewId}` : "/review?type=draft_approval"} className="jv-rec-open">Read</Link>
          </li>
        ))}
      </ul>
      {!confirm ? (
        <div className="jv-rec-foot">
          <button type="button" className="btn btn-primary btn-sm" disabled={!picked.length || pending} onClick={() => setConfirm(true)}><Check size={13} /> Approve {picked.length || ""} selected</button>
          <span className="muted text-xs">Strong ones are ticked for you. Read any you&apos;re unsure of first.</span>
        </div>
      ) : (
        <div className="jv-rec-confirm" role="alertdialog" aria-label="Confirm approval">
          <p>Approve <b>{picked.length}</b> email{picked.length === 1 ? "" : "s"}? Each is checked again (still waiting, evidence current, unsubscribe line present) and then goes out with the next send, within the sending limits. Sent emails can&apos;t be recalled.</p>
          <div className="jv-rec-foot">
            <button type="button" className="btn btn-primary btn-sm" onClick={go} disabled={pending}>{pending ? "Approving…" : "Yes, approve"}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(false)} disabled={pending}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="jv-auto-msg" role="status">{msg}</p>}
    </div>
  );
}
