import { humanize } from "@/lib/labels";
import { TIER_LABEL, tierLabel } from "@/lib/tier-label";
import { WhyThisEmail } from "@/components/why-this-email";
import type { DraftBrief } from "@/lib/outreach/brief";
import Link from "next/link";
import type { ReviewType } from "@prisma/client";
import { Check, ClipboardCheck, ExternalLink, UserCheck, UserX, X } from "lucide-react";
import { db } from "@/lib/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { ago, date } from "@/components/ui";
import { Badge as Kb, ConfidenceTag, EmptyState, FormField, PageHeader } from "@/components/kit";
import { KpiRow, KpiTile } from "@/components/viz/cards";
import { approveRejectionAction, keepCompanyAction, moreResearchAction, recheckWaitingPeopleAction, resolveIdentityAction, resolveReviewAction, reviewDraftAction } from "../actions";
import { DecideButton, KeyNav } from "./decide";
import { BodyEditor } from "./body-editor";
import { sellerFor } from "@/lib/seller";

/** The word limit from the account's tone rules ("under 120 words"), if it sets one. */
function wordLimit(sellerId: string | null | undefined): number | null {
  try {
    const rule = sellerFor(sellerId).tone.join(" ").match(/(?:under|max(?:imum)?|at most|no more than|fewer than)\s+(\d{2,3})\s+words/i);
    return rule ? Number(rule[1]) : null;
  } catch {
    return null;
  }
}
import { reviewLabel } from "@/lib/review-labels";
import { DECISION_FILTER_LABEL, DECISION_KIND, summarizeWaiting, typesFor, waitingNote } from "@/lib/decisions";

export const metadata = { title: "Approvals" };


export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ type?: string; kind?: string; view?: string; pick?: string }> }) {
  const sp = await searchParams;
  // ?type= takes one type or a comma list (each count's own list); ?kind= is a Decision Center filter.
  const kind = sp.kind === "exception" || sp.kind === "approval" ? sp.kind : undefined;
  const typeList = (sp.type ?? "").split(",").filter((t) => t in DECISION_KIND) as ReviewType[];
  const types = typeList.length ? typeList : kind ? typesFor(kind) : undefined;
  const type = typeList.length === 1 ? typeList[0] : undefined;
  const typeWhere = types ? { type: { in: types } } : {};
  const [counts, items, companies, lookalikes, handoffs] = await Promise.all([
    db.reviewItem.groupBy({ by: ["type"], where: { status: "open" }, _count: true }),
    db.reviewItem.findMany({ where: { status: "open", ...typeWhere }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: 50, include: { account: true, contact: { include: { fieldStates: true } } } }),
    // Waiting elsewhere, so everything a person must decide is listed here.
    db.prospectSuggestion.count({ where: { status: "new", origin: { not: "lookalike" } } }),
    db.prospectSuggestion.count({ where: { status: "new", origin: "lookalike", researchStatus: { in: ["done", "failed"] } } }),
    db.handoff.count({ where: { acknowledgedAt: null, blocked: false } }),
  ]);
  const draftIds = items.map((i) => i.draftId).filter(Boolean) as string[];
  const drafts = await db.draft.findMany({ where: { id: { in: draftIds } } });
  const evidenceIds = drafts.flatMap((d) => (d.claims as { factIds: string[] }[]).flatMap((c) => c.factIds));
  const evidence = await db.evidence.findMany({ where: { id: { in: evidenceIds } } });
  const evById = new Map(evidence.map((e) => [e.id, e]));
  const waiting = summarizeWaiting(counts as { type: ReviewType; _count: number }[]);
  const total = waiting.total;
  const shownTotal = types ? types.reduce((t, k) => t + (waiting.byType[k] ?? 0), 0) : total;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const threeAgo = new Date(dayStart.getTime() - 3 * 86_400_000);
  const base = { status: "open" as const, ...typeWhere };
  const [aToday, aFew, aOld] = await Promise.all([
    db.reviewItem.count({ where: { ...base, createdAt: { gte: dayStart } } }),
    db.reviewItem.count({ where: { ...base, createdAt: { gte: threeAgo, lt: dayStart } } }),
    db.reviewItem.count({ where: { ...base, createdAt: { lt: threeAgo } } }),
  ]);
  const aAll = aToday + aFew + aOld;
  const href = (q: Record<string, string | undefined>) => `/review?${new URLSearchParams(Object.entries({ type: sp.type, kind, ...q }).filter(([, v]) => v) as [string, string][])}`;
  const idx = Math.max(0, items.findIndex((i) => i.id === sp.pick));
  const r = items[idx];
  const prev = idx > 0 ? href({ pick: items[idx - 1].id }) : undefined;
  const next = idx < items.length - 1 ? href({ pick: items[idx + 1].id }) : undefined;
  const draft = r?.draftId ? drafts.find((d) => d.id === r.draftId) : undefined;
  // The version this draft replaced (the research changed before it was approved).
  const earlier = draft?.replacesId ? await db.draft.findUnique({ where: { id: draft.replacesId }, select: { subject: true, body: true, reviewerNote: true, createdAt: true } }) : null;
  const reports = r?.type === "possible_blocker" || r?.type === "proposed_rejection" ? ((r.payload as { reports?: { kind: string; claim: string; quote: string | null; sourceUrl: string; publishedAt: string }[] } | null)?.reports ?? []) : [];

  return (
    <div className="page-enter">
      <PageHeader title="Approvals" description={`${waiting.total ? `${waiting.total} waiting for you: ${waitingNote(waiting)}.` : "Nothing waiting for you."}${types ? ` Showing ${shownTotal} of them.` : ""} Only a person can decide these; pick one on the left and its evidence and actions open on the right.`} />
      {(() => {
        const n = (ts: ReviewType[]) => ts.reduce((t, k) => t + (waiting.byType[k] ?? 0), 0);
        const PERSON: ReviewType[] = ["identity_conflict", "no_usable_person"];
        const RULE_OUT: ReviewType[] = ["proposed_rejection", "possible_blocker"];
        const person = n(PERSON);
        const ruleOut = n(RULE_OUT);
        const restTypes = (Object.keys(waiting.byType) as ReviewType[]).filter((t) => ![...PERSON, ...RULE_OUT, "draft_approval"].includes(t));
        const other = n(restTypes);
        const list = (ts: ReviewType[]) => `/review?${new URLSearchParams({ type: ts.join(",") })}`;
        return (
          <div className="mb-5"><KpiRow>
            <KpiTile tint={0} label="Right person?" value={person} note="job or company doesn't match, or no usable contact" href={list(PERSON)} />
            <KpiTile tint={1} label="Rule out a company?" value={ruleOut} note="a rule or bad news says so" href={list(RULE_OUT)} />
            <KpiTile tint={2} label="Emails to approve" value={waiting.emails} note="email drafts waiting for your sign-off" href="/review?type=draft_approval" />
            <KpiTile tint={3} label="Everything else" value={other} note="replies, refreshed drafts, budget and data checks" href={other ? list(restTypes) : "/review"} />
          </KpiRow>
          {n(["identity_conflict"]) > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <ActionButton action={recheckWaitingPeopleAction} className="btn btn-secondary btn-sm"><UserCheck size={14} /> Re-check waiting people</ActionButton>
              <span className="muted text-xs">Free: uses what we already have. Same title written differently, or an email on the company&apos;s own domain, counts as confirmed. Real mismatches and missing emails stay here.</span>
            </div>
          )}</div>
        );
      })()}

      <div className="dz-chips" role="group" aria-label="Filter by kind">
        <Link href="/review" className={`dz-chip${!types ? " on" : ""}`}>All · {total}</Link>
        {types && !type && <span className="dz-chip on" aria-current="true">{kind ? DECISION_FILTER_LABEL[kind] : typeList.map((t) => reviewLabel(t)).join(" + ")} · {shownTotal}</span>}
        {counts.sort((a, b) => b._count - a._count).map((c) => (
          <Link key={c.type} href={`/review?type=${c.type}`} className={`dz-chip${type === c.type ? " on" : ""}`}>{reviewLabel(c.type)} · {c._count}</Link>
        ))}
        {companies > 0 && <Link href="/discover" className="dz-chip out">Companies to approve · {companies} <ExternalLink size={12} aria-hidden /></Link>}
        {lookalikes > 0 && <Link href="/import/lookalikes?view=review" className="dz-chip out">Lookalikes to review · {lookalikes} <ExternalLink size={12} aria-hidden /></Link>}
        {handoffs > 0 && <Link href="/handoffs" className="dz-chip out">Hand-offs to accept · {handoffs} <ExternalLink size={12} aria-hidden /></Link>}
      </div>

      {aAll > 0 && (
        <div className="ws-ages rv-ages" aria-label={`How long these have waited: ${aToday} from today, ${aFew} from 1 to 3 days, ${aOld} older`}>
          <div className="ws-ages-bar" aria-hidden>
            {aToday > 0 && <i className="a0" style={{ flex: aToday }} />}
            {aFew > 0 && <i className="a1" style={{ flex: aFew }} />}
            {aOld > 0 && <i className="a2" style={{ flex: aOld }} />}
          </div>
          <div className="ws-ages-key"><span><i className="a0" />Today {aToday}</span><span><i className="a1" />1–3 days {aFew}</span><span><i className="a2" />Older {aOld}</span></div>
        </div>
      )}

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
                {it.dueAt && it.dueAt < new Date() && <span className="dz-over">Overdue · due {date(it.dueAt)}</span>}
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
                    {r.account?.tier && <> · {tierLabel(r.account.tier)}</>} · opened {ago(r.createdAt)}{r.dueAt ? ` · due ${date(r.dueAt)}` : ""}
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
                        <Kb tone="warning">{humanize(x.kind)}</Kb>
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
                <>
                <WhyThisEmail brief={draft.brief as unknown as DraftBrief | null} />
                {earlier && (
                  <details className="wte mb-3 text-sm">
                    <summary className="cursor-pointer font-semibold">Earlier version ({ago(earlier.createdAt)}){earlier.reviewerNote ? ` · ${earlier.reviewerNote.replace(/^Replaced before approval: /, "replaced because of ")}` : ""}</summary>
                    <p className="mt-2 font-semibold">{earlier.subject}</p>
                    <pre className="secondary mt-1 whitespace-pre-wrap font-sans text-sm">{earlier.body.split(/\n\n[^\n]*\n[^\n]* · /)[0]}</pre>
                  </details>
                )}
                <div className="dz-body dz-draft">
                  <ActionForm action={reviewDraftAction} className="dz-form" resetOnSuccess={false}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <p className="dz-meta">To {r.contact ? <Link href={`/people/${r.contact.id}`}>{r.contact.fullName}</Link> : null} · {r.contact?.titleNormalized} · <span className="mono">{r.contact?.email}</span></p>
                    <FormField label="Subject"><input name="subject" defaultValue={draft.subject} className="glass-input" /></FormField>
                    <FormField label="Body" hint="Edits must keep the unsubscribe line and sender address."><BodyEditor name="body" initial={draft.body} limit={wordLimit(r.account?.sellerId)} /></FormField>
                    <FormField label="Note (optional): why you edited or rejected it"><input name="note" className="glass-input" placeholder="e.g. too long, wrong person, claim not strong enough" /></FormField>
                    <div className="dz-actions">
                      <SubmitButton name="decision" value="approve" className="btn btn-primary"><Check size={15} /> Approve</SubmitButton>
                      <SubmitButton name="decision" value="reject" className="btn btn-secondary"><X size={15} /> Reject</SubmitButton>
                    </div>
                  </ActionForm>
                  <aside className="dz-claims">
                    {(draft.useCase || draft.painPoint) && <p className="dz-explain"><b>Angle:</b> {humanize(draft.useCase)}{draft.painPoint ? ` — ${draft.painPoint}` : ""}</p>}
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
                </>
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
