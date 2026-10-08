import Link from "next/link";
import type { ReviewType } from "@prisma/client";
import { Check, ClipboardCheck, ExternalLink, Layers, List, UserCheck, UserX, X } from "lucide-react";
import { db } from "@/lib/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, FieldBadge, PageHeader, TierBadge, ago, cx, date } from "@/components/ui";
import { resolveIdentityAction, resolveReviewAction, reviewDraftAction } from "../actions";
import { ViewSwitch } from "@/components/v2";
import { ApprovalStack } from "./approval-stack";

export const metadata = { title: "Review queue" };

const TYPE_LABEL: Partial<Record<ReviewType, string>> = {
  draft_approval: "Email to approve",
  identity_conflict: "Is this the right person?",
  contradiction: "Sources disagree",
  guardrail_failed: "Email held by checks",
  budget_exceeded: "Research budget reached",
  no_usable_person: "Nobody to contact yet",
  lawful_basis_missing: "Missing legal basis",
  briefing_blocked: "Hand-off brief blocked",
  needs_human_reply: "Unclear reply",
  bounce_breaker: "Too many bounces — sending paused",
  other: "Suggestion or other",
};

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ type?: string; view?: string }> }) {
  const sp = await searchParams;
  const type = sp.type as ReviewType | undefined;
  const view = sp.view === "list" ? "list" : "focus";
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
  const stack = view === "focus" ? items.filter((r) => r.type === "draft_approval" && drafts.some((d) => d.id === r.draftId)).map((r) => ({ id: r.id, contact: r.contact, account: r.account, draft: drafts.find((d) => d.id === r.draftId)! })) : [];
  const listItems = view === "focus" ? items.filter((r) => r.type !== "draft_approval") : items;

  return (
    <div className="page-enter">
      <PageHeader eyebrow="Only a person can decide these" title="Approvals" sub="Emails come one at a time, with their checks. Other decisions are listed underneath, each with its reason." actions={<ViewSwitch base="/review" params={{ type }} current={view} views={[{ id: "focus", label: "One at a time", icon: <Layers size={13} /> }, { id: "list", label: "Everything", icon: <List size={13} /> }]} />} />

      <div className="mb-5 flex flex-wrap gap-2">
        <Link href="/review" className="badge" style={{ background: !type ? "var(--accent-indigo)" : "var(--surface-card)", color: !type ? "#fff" : "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>All · {total}</Link>
        {counts.sort((a, b) => b._count - a._count).map((c) => (
          <Link key={c.type} href={`/review?type=${c.type}`} className="badge" style={{ background: type === c.type ? "var(--accent-indigo)" : "var(--surface-card)", color: type === c.type ? "#fff" : "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>
            {TYPE_LABEL[c.type] ?? c.type} · {c._count}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <Card><Empty icon={<ClipboardCheck size={20} />} title="Nothing waiting" sub="When the pipeline needs a decision, it lands here with its reason." /></Card>
      ) : (
        <>
        {stack.length > 0 && <ApprovalStack items={stack} />}
        {view === "focus" && stack.length > 0 && listItems.length > 0 && <div className="section-label"><span>Other decisions</span><span className="n">{listItems.length}</span></div>}
        <div className="stagger grid gap-4">
          {listItems.map((r) => {
            const draft = r.draftId ? drafts.find((d) => d.id === r.draftId) : undefined;
            const overdue = r.dueAt && r.dueAt < new Date();
            return (
              <section key={r.id} className="glass-card-static card-pad" style={{ borderLeft: `4px solid ${r.type === "draft_approval" ? "#8B5CF6" : r.type === "budget_exceeded" || r.type === "bounce_breaker" ? "#EF4444" : "#F59E0B"}` }}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color="#7C3AED">{TYPE_LABEL[r.type] ?? r.type}</Badge>
                                            {overdue && <Badge color="#DC2626">overdue</Badge>}
                    </div>
                    <div className="mt-1.5 text-[0.95rem] font-semibold" style={{ color: "var(--text-primary)" }}>{r.reason}</div>
                    <div className="muted mt-0.5 text-xs">
                      {r.account && <Link href={`/accounts/${r.account.id}`} className="hover:underline">{r.account.name}</Link>}
                      {r.account && <> · <TierBadge tier={r.account.tier} /></>} · opened {ago(r.createdAt)}{r.dueAt ? ` · due ${date(r.dueAt)}` : ""}
                    </div>
                  </div>
                  {r.type !== "draft_approval" && r.type !== "identity_conflict" && (
                    <div className="flex gap-2">
                      <ActionButton action={resolveReviewAction.bind(null, r.id, "resolved", undefined)} className="btn btn-success btn-sm"><Check size={14} /> Resolve</ActionButton>
                      <ActionButton action={resolveReviewAction.bind(null, r.id, "dismissed", undefined)} className="btn btn-ghost btn-sm">Dismiss</ActionButton>
                    </div>
                  )}
                </div>

                {r.type === "draft_approval" && draft && (
                  <div className="grid gap-5 lg:grid-cols-5">
                    <ActionForm action={reviewDraftAction} className="grid gap-3 lg:col-span-3" resetOnSuccess={false}>
                      <input type="hidden" name="draftId" value={draft.id} />
                      <div><label className="field-label">To</label><div className="text-sm secondary">{r.contact ? <Link href={`/people/${r.contact.id}`} className="hover:underline">{r.contact.fullName}</Link> : null} · {r.contact?.titleNormalized} · <span className="mono">{r.contact?.email}</span></div></div>
                      <div><label className="field-label" htmlFor={`s-${draft.id}`}>Subject</label><input id={`s-${draft.id}`} name="subject" defaultValue={draft.subject} className="glass-input" /></div>
                      <div><label className="field-label" htmlFor={`b-${draft.id}`}>Body</label><textarea id={`b-${draft.id}`} name="body" defaultValue={draft.body} className="glass-textarea" rows={11} /></div>
                      <input name="note" className="glass-input" placeholder="Optional note for the log" />
                      <div className="flex flex-wrap justify-end gap-2">
                        <SubmitButton name="decision" value="reject" className="btn btn-secondary"><X size={15} /> Reject</SubmitButton>
                        <SubmitButton name="decision" value="approve" className="btn btn-success"><Check size={15} /> Approve</SubmitButton>
                      </div>
                    </ActionForm>
                    <div className="lg:col-span-2">
                      {(draft.useCase || draft.painPoint) && (
                        <div className="mb-3 rounded-xl px-3 py-2.5 text-xs" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
                          <div className="micro mb-1">Angle for this person</div>
                          <div className="secondary">{draft.useCase?.replace(/_/g, " ")}{draft.painPoint ? ` — ${draft.painPoint}` : ""}</div>
                        </div>
                      )}
                      <div className="micro mb-2">Claims and the evidence they cite</div>
                      <ul className="grid gap-2.5">
                        {(draft.claims as { text: string; factIds: string[] }[]).map((c, i) => (
                          <li key={i} className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
                            <div className="secondary">“{c.text}”</div>
                            {Array.isArray(draft.claimCheck) && (draft.claimCheck as { supported: boolean; reason: string }[])[i] && (
                              <div className="mt-1 font-semibold" style={{ color: (draft.claimCheck as { supported: boolean }[])[i].supported ? "#059669" : "#DC2626" }}>
                                {(draft.claimCheck as { supported: boolean }[])[i].supported ? "✓ Checked: the source says this" : "✕ Checker: not supported"} <span className="muted font-normal">— {(draft.claimCheck as { reason: string }[])[i].reason}</span>
                              </div>
                            )}
                            {c.factIds.map((id) => {
                              const e = evById.get(id);
                              return e ? (
                                <div key={id} className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <FieldBadge status={e.status} />
                                  <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mono muted inline-flex items-center gap-1 hover:underline">{e.sourceType} · {date(e.publishedAt)}<ExternalLink size={10} /></a>
                                </div>
                              ) : <div key={id} className="mt-1 text-[#DC2626]">Missing fact {id}</div>;
                            })}
                          </li>
                        ))}
                      </ul>
                      <p className="muted mt-3 text-xs">Guardrail passed on attempt {draft.guardrailAttempts}{draft.claimCheck == null ? " · claim checker was unavailable, so read each claim against its source" : ""}. Edits must keep the unsubscribe line and sender address.</p>
                    </div>
                  </div>
                )}

                {r.type === "identity_conflict" && r.contact && (
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex flex-wrap gap-4 text-xs">
                      {["email", "title", "company"].map((f) => {
                        const st = r.contact!.fieldStates.find((x) => x.field === f);
                        return <div key={f}><div className="micro mb-1">{f}</div><div className="flex items-center gap-1.5"><FieldBadge status={st?.status} /><span className="mono muted">{st?.value ?? "—"}</span></div></div>;
                      })}
                      {(r.payload as { providerEmployer?: string } | null)?.providerEmployer && <div><div className="micro mb-1">Provider says employer</div><span className="mono secondary">{(r.payload as { providerEmployer: string }).providerEmployer}</span></div>}
                    </div>
                    <div className="flex gap-2">
                      <ActionButton action={resolveIdentityAction.bind(null, r.id, "drop")} className="btn btn-secondary btn-sm"><UserX size={14} /> Drop contact</ActionButton>
                      <ActionButton action={resolveIdentityAction.bind(null, r.id, "confirm")} className="btn btn-primary btn-sm"><UserCheck size={14} /> Confirm identity</ActionButton>
                    </div>
                  </div>
                )}

                {r.type === "needs_human_reply" && (r.payload as { body?: string } | null)?.body && (
                  <blockquote className={cx("rounded-xl px-4 py-3 text-sm secondary")} style={{ background: "var(--surface-card-header)" }}>“{(r.payload as { body: string }).body}”</blockquote>
                )}
              </section>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
