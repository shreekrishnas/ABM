import Link from "next/link";
import { Check, ShieldCheck, X } from "lucide-react";
import type { Draft } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/client";
import { Avatar, TierBadge } from "@/components/ui";
import { reviewDraftAction } from "../actions";

type Item = { id: string; contact: { id: string; fullName: string; titleNormalized: string | null; email: string | null } | null; account: { id: string; name: string; tier: "T1" | "T2" | "T3" | null } | null; draft: Draft };

/** Approvals as a stack: one email at a time, the decision right under it, the rest waiting behind. */
export function ApprovalStack({ items }: { items: Item[] }) {
  const [top, ...rest] = items;
  const d = top.draft;
  const checks = Array.isArray(d.claimCheck) ? (d.claimCheck as { supported: boolean }[]) : null;
  const supported = checks?.filter((c) => c.supported).length ?? 0;
  const critique = Array.isArray(d.critique) ? (d.critique as { critic: string; pass: boolean }[]) : [];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="relative pb-5">
        {/* the stack behind */}
        {rest.length > 1 && <div aria-hidden className="glass-card-static absolute inset-x-8 bottom-0 top-10" style={{ opacity: 0.45 }} />}
        {rest.length > 0 && <div aria-hidden className="glass-card-static absolute inset-x-4 bottom-2.5 top-5" style={{ opacity: 0.7 }} />}
        <section className="glass-card-static read relative card-pad" style={{ borderRadius: "1.5rem" }} aria-label="Email to approve">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {top.contact && <Avatar name={top.contact.fullName} id={top.contact.id} size={42} round />}
              <div>
                <div className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                  {top.contact ? <Link href={`/people/${top.contact.id}`} className="hover:underline">{top.contact.fullName}</Link> : "—"}
                  <span className="secondary font-medium"> · {top.account ? <Link href={`/accounts/${top.account.id}`} className="hover:underline">{top.account.name}</Link> : ""}</span>
                </div>
                <div className="muted text-xs">{top.contact?.titleNormalized ?? ""} · <span className="mono">{top.contact?.email}</span></div>
              </div>
            </div>
            <div className="flex items-center gap-2"><TierBadge tier={top.account?.tier ?? null} /><span className="badge" style={{ background: "var(--surface-card-header)", color: "var(--text-secondary)" }}>1 of {items.length}</span></div>
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {checks && <span className="chip" style={{ ["--c" as string]: supported === checks.length ? "var(--ok)" : "var(--stop)" }}><ShieldCheck size={12} /> {supported}/{checks.length} claims match their sources</span>}
            {critique.map((c) => <span key={c.critic} className="chip" style={{ ["--c" as string]: c.pass ? "var(--ok)" : "var(--wait)" }}>{c.critic.replace(/ \((code|model)\)/, "")}</span>)}
            {d.rewrites > 0 && <span className="chip">Rewritten {d.rewrites}× by the brain</span>}
            {d.painPoint && <span className="chip" style={{ ["--c" as string]: "var(--accent-indigo)" }}>Angle: {d.painPoint.slice(0, 60)}{d.painPoint.length > 60 ? "…" : ""}</span>}
          </div>

          <ActionForm action={reviewDraftAction} className="grid gap-3" resetOnSuccess={false}>
            <input type="hidden" name="draftId" value={d.id} />
            <input name="subject" defaultValue={d.subject} aria-label="Subject" className="glass-input text-[0.95rem] font-semibold" />
            <textarea name="body" defaultValue={d.body} aria-label="Email body" className="glass-textarea" rows={12} style={{ lineHeight: 1.6 }} />
            <input name="note" className="glass-input" placeholder="Note for the log (optional)" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="muted text-xs">Edits are kept and teach the brain. The unsubscribe line and address must stay.</span>
              <div className="flex gap-2">
                <SubmitButton name="decision" value="reject" className="btn btn-secondary"><X size={15} /> Reject</SubmitButton>
                <SubmitButton name="decision" value="approve" className="btn btn-brand"><Check size={15} /> Approve &amp; next</SubmitButton>
              </div>
            </div>
          </ActionForm>
        </section>
      </div>

      <aside>
        <div className="micro mb-2">Up next · {rest.length}</div>
        {rest.length === 0 ? <p className="muted text-xs">This is the last one.</p> : (
          <ol className="grid gap-1.5">
            {rest.slice(0, 12).map((r, i) => (
              <li key={r.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs" style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}>
                <span className="tnum muted w-4">{i + 2}</span>
                {r.contact && <Avatar name={r.contact.fullName} id={r.contact.id} size={22} round />}
                <span className="min-w-0"><span className="block truncate font-semibold" style={{ color: "var(--text-primary)" }}>{r.contact?.fullName}</span><span className="muted block truncate">{r.account?.name}</span></span>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
