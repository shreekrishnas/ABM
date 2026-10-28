import Link from "next/link";
import type { ReviewType } from "@prisma/client";
import { Check, ClipboardCheck, ExternalLink, UserCheck, UserX, X } from "lucide-react";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/client";
import { ago, date } from "@/components/ui";
import { Badge as Kb, ConfidenceTag, EmptyState, FormField, PageHeader } from "@/components/kit";
import { approveRejectionAction, keepCompanyAction, moreResearchAction, resolveIdentityAction, resolveReviewAction, reviewDraftAction } from "../actions";
import { DecideButton, KeyNav } from "./decide";
import { reviewLabel } from "@/lib/review-labels";

export const metadata = { title: "Approvals" };


export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ type?: string; view?: string; pick?: string }> }) {
  const sp = await searchParams;
  const type = sp.type as ReviewType | undefined;
  const [counts, items] = await Promise.all([
    db.reviewItem.groupBy({ by: ["type"], where: { status: "open" }, _count: true }),
    db.reviewItem.findMany({ where: { status: "open", ...(type ? { type } : {}) }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: 50, include: { account: true, contact: { include: { fieldStates: true } } } }),
  ]);
  const draftIds = items.map((i) => i.draftId).filter(Boolean) as string[];
  const drafts = await db.draft.findMany({ where: { id: { in: draftIds } } });
  const evidenceIds = drafts.flatMap((d) => (d.claims as { factIds: string[] }[]).flatMap((c) => c.factIds));
  const evidence = await db.evidence.findMany({ where: { id: { in: evidenceIds } } });
  const evById = new Map(evidence.map((e) => [e.id, e]));
  const total = counts.reduce((a, c) => a + c._count, 0);
  const href = (q: Record<string, string | undefined>) => `/review?${new URLSearchParams(Object.entries({ type, ...q }).filter(([, v]) => v) as [string, string][])}`;
  const idx = Math.max(0, items.findIndex((i) => i.id === sp.pick));
  const r = items[idx];
  const prev = idx > 0 ? href({ pick: items[idx - 1].id }) : undefined;
  const next = idx < items.length - 1 ? href({ pick: items[idx + 1].id }) : undefined;
  const draft = r?.draftId ? drafts.find((d) => d.id === r.draftId) : undefined;
  const reports = r?.type === "possible_blocker" || r?.type === "proposed_rejection" ? ((r.payload as { reports?: { kind: string; claim: string; quote: string | null; sourceUrl: string; publishedAt: string }[] } | null)?.reports ?? []) : [];

  return (
    <div className="page-enter">
      <PageHeader title="Approvals" description="Only a person can decide these. Pick one on the left; its evidence and actions open on the right." />

      <div className="dz-chips" role="group" aria-label="Filter by kind">
        <Link href="/review" className={`dz-chip${!type ? " on" : ""}`}>All · {total}</Link>
        {counts.sort((a, b) => b._count - a._count).map((c) => (
          <Link key={c.type} href={`/review?type=${c.type}`} className={`dz-chip${type === c.type ? " on" : ""}`}>{reviewLabel(c.type)} · {c._count}</Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="k-table-wrap"><EmptyState icon={<ClipboardCheck size={20} />} title="Nothing waiting" text="When the pipeline needs a decision, it lands here with its reason." /></div>
      ) : (
        <div className="dz">
          <KeyNav prev={prev} next={next} />
          <nav className="dz-list" aria-label="Decisions">
            <p className="dz-count">{idx + 1} of {items.length}{items.length === 50 ? "+" : ""}</p>
            {items.map((it) => (
              <Link key={it.id} href={href({ pick: it.id })} scroll={false} className={`dz-item${it.id === r?.id ? " on" : ""}`} aria-current={it.id === r?.id ? "true" : undefined}>
                <Kb tone={it.type === "possible_blocker" || it.type === "proposed_rejection" || type === "proposed_rejection" || it.type === "bounce_breaker" || it.type === "budget_exceeded" ? "danger" : it.type === "draft_approval" ? "accent" : "warning"}>{reviewLabel(it.type)}</Kb>
                <b>{[it.contact?.fullName, it.account?.name].filter(Boolean).join(" · ") || reviewLabel(it.type)}</b>
                <span>{it.reason}</span>
                {it.dueAt && it.dueAt < new Date() && <span className="dz-over">Overdue</span>}
              </Link>
            ))}
          </nav>

          {r && (
            <section className="dz-pane" aria-label="Decision">
              <header className="dz-head">
                <div className="min-w-0">
                  <Kb tone={r.type === "possible_blocker" || r.type === "proposed_rejection" ? "danger" : r.type === "draft_approval" ? "accent" : "warning"}>{reviewLabel(r.type)}</Kb>
                  <h2>{r.reason}</h2>
                  <p className="dz-meta">
                    {r.account && <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link>}
                    {r.account?.tier && <> · Tier {r.account.tier}</>} · opened {ago(r.createdAt)}{r.dueAt ? ` · due ${date(r.dueAt)}` : ""}
                  </p>
                </div>
                <p className="dz-keys"><kbd>J</kbd> next · <kbd>K</kbd> previous</p>
              </header>

              {(r.type === "possible_blocker" || r.type === "proposed_rejection") && (
                <div className="dz-body">
                  <p className="dz-explain">{r.type === "possible_blocker" ? "The research found news that might rule this company out, but only one source reports it. Nothing is ruled out until you decide." : "A rule would rule this company out. It stays paused, not rejected, until you decide. Keep it and the rule no longer stops it."}</p>
                  <ul className="dz-reports">
                    {reports.map((x, i) => (
                      <li key={i}>
                        <Kb tone="warning">{x.kind.replace(/_/g, " ")}</Kb>
                        <p>{x.claim}</p>
                        {x.quote && <blockquote>“{x.quote}”</blockquote>}
                        <a href={x.sourceUrl} target="_blank" rel="noreferrer">{(() => { try { return new URL(x.sourceUrl).hostname.replace(/^www\./, ""); } catch { return x.sourceUrl; } })()} · {date(new Date(x.publishedAt))} <ExternalLink size={11} /></a>
                      </li>
                    ))}
                  </ul>
                  <div className="dz-actions">
                    <DecideButton action={keepCompanyAction.bind(null, r.id)} label="Keep company" done="Kept" kind="primary" next={next} />
                    <DecideButton action={moreResearchAction.bind(null, r.id)} label="Research again" done="Researching again" next={next} />
                    <DecideButton action={approveRejectionAction.bind(null, r.id)} label="Approve rejection" done="Ruled out" kind="danger" next={next} />
                  </div>
                </div>
              )}

              {r.type === "identity_conflict" && r.contact && (
                <div className="dz-body">
                  <dl className="dz-fields">
                    {["email", "title", "company"].map((f) => {
                      const st = r.contact!.fieldStates.find((x) => x.field === f);
                      return <div key={f}><dt>{f[0].toUpperCase() + f.slice(1)}</dt><dd><ConfidenceTag status={st?.status ?? "unknown"} /> <span className="mono">{st?.value ?? "—"}</span></dd></div>;
                    })}
                    {(r.payload as { providerEmployer?: string } | null)?.providerEmployer && <div><dt>Provider says employer</dt><dd className="mono">{(r.payload as { providerEmployer: string }).providerEmployer}</dd></div>}
                  </dl>
                  <div className="dz-actions">
                    <DecideButton action={resolveIdentityAction.bind(null, r.id, "confirm")} label={<><UserCheck size={14} /> Confirm identity</>} done="Identity confirmed" kind="primary" next={next} />
                    <DecideButton action={resolveIdentityAction.bind(null, r.id, "drop")} label={<><UserX size={14} /> Drop contact</>} done="Contact dropped" next={next} />
                  </div>
                </div>
              )}

              {r.type === "draft_approval" && draft && (
                <div className="dz-body dz-draft">
                  <ActionForm action={reviewDraftAction} className="dz-form" resetOnSuccess={false}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <p className="dz-meta">To {r.contact ? <Link href={`/people/${r.contact.id}`}>{r.contact.fullName}</Link> : null} · {r.contact?.titleNormalized} · <span className="mono">{r.contact?.email}</span></p>
                    <FormField label="Subject"><input name="subject" defaultValue={draft.subject} className="glass-input" /></FormField>
                    <FormField label="Body" hint="Edits must keep the unsubscribe line and sender address."><textarea name="body" defaultValue={draft.body} className="glass-textarea" rows={11} /></FormField>
                    <FormField label="Note for the log (optional)"><input name="note" className="glass-input" /></FormField>
                    <div className="dz-actions">
                      <SubmitButton name="decision" value="approve" className="btn btn-primary"><Check size={15} /> Approve</SubmitButton>
                      <SubmitButton name="decision" value="reject" className="btn btn-secondary"><X size={15} /> Reject</SubmitButton>
                    </div>
                  </ActionForm>
                  <aside className="dz-claims">
                    {(draft.useCase || draft.painPoint) && <p className="dz-explain"><b>Angle:</b> {draft.useCase?.replace(/_/g, " ")}{draft.painPoint ? ` — ${draft.painPoint}` : ""}</p>}
                    <h3>Claims and their evidence</h3>
                    <ul>
                      {(draft.claims as { text: string; factIds: string[] }[]).map((c, i) => {
                        const chk = Array.isArray(draft.claimCheck) ? (draft.claimCheck as { supported: boolean; reason: string }[])[i] : undefined;
                        return (
                          <li key={i}>
                            <p>“{c.text}”</p>
                            {chk && <Kb tone={chk.supported ? "success" : "danger"}>{chk.supported ? "Checked: the source says this" : "Not supported"}</Kb>}
                            {c.factIds.map((id) => { const e = evById.get(id); return e ? <a key={id} href={e.sourceUrl} target="_blank" rel="noreferrer" className="dz-src"><ConfidenceTag status={e.status} /> {e.sourceType} · {date(e.publishedAt)} <ExternalLink size={10} /></a> : <span key={id} className="dz-over">Missing fact</span>; })}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="dz-meta">Guardrail passed on attempt {draft.guardrailAttempts}{draft.claimCheck == null ? " · claim checker unavailable: read each claim against its source" : ""}.</p>
                  </aside>
                </div>
              )}

              {r.type === "needs_human_reply" && (r.payload as { body?: string } | null)?.body && <blockquote className="dz-quote">“{(r.payload as { body: string }).body}”</blockquote>}

              {!["possible_blocker", "proposed_rejection", "identity_conflict", "draft_approval"].includes(r.type) && (
                <div className="dz-actions">
                  <DecideButton action={resolveReviewAction.bind(null, r.id, "resolved", undefined)} label={<><Check size={14} /> Resolve</>} done="Resolved" kind="primary" next={next} />
                  <DecideButton action={resolveReviewAction.bind(null, r.id, "dismissed", undefined)} label="Dismiss" done="Dismissed" kind="ghost" next={next} />
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
