import { CheckCircle2, MessageSquareText, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { CopyButton } from "@/components/copy-button";
import { Card, FieldBadge } from "@/components/ui";
import { JOURNEY_STAGES, STAGE_INFO, type Stage } from "@/lib/journey/stages";
import { loadWorkspace, nextStep } from "@/lib/linkedin/service";
import { ANSWER_KINDS } from "@/lib/linkedin/rules";
import { KIND_LABEL, MESSAGE_KINDS, type ConversationSummary, type MessageKind, type ReplyAnalysis } from "@/lib/linkedin/types";
import {
  approveLinkedInAction, confirmLinkedInReplyAction, correctSummaryAction, discardLinkedInAction, editLinkedInAction, generateLinkedInAction,
  markSentLinkedInAction, recordLinkedInReplyAction, refreshSummaryAction, upToDateLinkedInAction,
} from "./linkedin-actions";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const TYPE_LABEL: Record<string, string> = { positive_interest: "Interest", information_request: "Asks for information", objection: "Objection", existing_vendor: "Has a vendor", timing_later: "Later", referral: "Referral", not_interested: "Not interested", stop_request: "Asked to stop", neutral: "Neutral", out_of_office: "Out of office" };
const INTENT_LABEL = { explicit: "Explicit interest", possible: "Possible future opportunity", none: "No buying intent" } as const;

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{children}</h3>;
}

/** Research-aware LinkedIn conversation assistant for one person and one sender. Nothing is sent automatically. */
export async function LinkedInWorkspace({ journeyId }: { journeyId: string }) {
  const w = await loadWorkspace(journeyId);
  const next = nextStep(w);
  const summary = w.j.summary as unknown as ConversationSummary | null;
  const drafts = w.j.messages.filter((m) => m.direction === "out" && ["draft", "blocked", "approved"].includes(m.status)).reverse();
  const timeline = w.j.messages.filter((m) => m.status === "sent" || m.status === "received");
  const pending = w.received.filter((m) => !(m.analysis as { confirmed?: string } | null)?.confirmed);
  const stage = w.j.stage as Stage;
  const kinds = MESSAGE_KINDS.filter((k) => !w.block || ANSWER_KINDS.includes(k));
  const defaultKind = next.kind ?? (stage === "not_contacted" ? "connection_request" : "custom");

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><MessageSquareText size={16} aria-hidden /> LinkedIn messaging</span>}
      sub={`${w.j.sender.name} · ${w.j.campaign.name} · ${STAGE_INFO[stage].label}. The AI drafts; you edit, copy and send on LinkedIn, then record it here.`}
    >
      {/* Recommended next action */}
      <div className="mb-5 rounded-xl px-4 py-3 text-sm" style={{ background: w.block ? "var(--warning-bg)" : "var(--indigo-bg)" }}>
        <div className="font-semibold" style={{ color: w.block ? "var(--warning-strong)" : "var(--indigo-strong)" }}>Next: {next.text}{next.on && next.kind === null && !w.block ? ` (${day(next.on)})` : ""}</div>
        <div className="secondary mt-0.5 text-xs">{next.why}</div>
        {w.lastOut && !w.block && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="muted">{w.j.upToDateAt && w.j.upToDateAt >= w.lastOut ? `Conversation confirmed up to date on ${day(w.j.upToDateAt)}.` : "Before a follow-up, confirm there's no reply on LinkedIn you haven't recorded."}</span>
            <ActionButton action={upToDateLinkedInAction.bind(null, journeyId)} className="btn btn-ghost btn-sm">No new replies on LinkedIn</ActionButton>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Contact intelligence */}
        <section className="lg:col-span-2">
          <H>Contact intelligence</H>
          <dl className="grid gap-1.5 text-xs">
            <div><dt className="muted inline">Role: </dt><dd className="inline">{w.c.titleNormalized ?? w.c.title ?? "title unknown"} · {w.c.buyingRole.replace("_", " ")}{w.persona ? ` · ${w.persona.why}` : ""}</dd></div>
            {w.brief?.whyNow && <div><dt className="muted inline">Why now: </dt><dd className="inline">{w.brief.whyNow.text}</dd></div>}
            {w.pain && <div><dt className="muted inline">Suggested angle: </dt><dd className="inline">{w.pain.pain} → {w.pain.capability}</dd></div>}
            {w.emailReplies.length > 0 && <div style={{ color: "var(--warning-strong)" }}>They replied by email on {day(w.emailReplies[0].receivedAt)}: check that thread before a LinkedIn pitch.</div>}
          </dl>
          <div className="mt-3 grid gap-1.5">
            <div className="muted text-xs font-semibold">Facts a message can cite ({w.facts.length})</div>
            {w.facts.length === 0 ? <p className="muted text-xs">No verified or probable facts yet: messages stay general and make no claims about the company.</p> : w.facts.slice(0, 6).map((f) => (
              <div key={f.id} className="flex items-start gap-1.5 text-xs">
                <FieldBadge status={f.status} />
                <span className="secondary">{f.claim}{w.usedFacts.has(f.id) && <span className="muted"> · used</span>}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Composer */}
        <section className="lg:col-span-3">
          <H>Message composer</H>
          <ActionForm action={generateLinkedInAction.bind(null, journeyId)} className="flex flex-wrap items-end gap-2" resetOnSuccess={false}>
            <label className="grid gap-1 text-xs">Type
              <select name="kind" defaultValue={defaultKind} className="glass-input" disabled={kinds.length === 0}>
                {kinds.map((k) => <option key={k} value={k} disabled={k === "follow_up" && !w.eligibility.eligible}>{KIND_LABEL[k]}{k === "follow_up" && !w.eligibility.eligible ? " (not due)" : ""}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 flex-1 gap-1 text-xs">Note for the AI (optional)
              <input name="note" className="glass-input" placeholder="e.g. mention the new plant; keep it under 3 lines" maxLength={300} />
            </label>
            <SubmitButton className="btn btn-primary btn-sm"><Sparkles size={13} /> Generate</SubmitButton>
          </ActionForm>

          <div className="mt-3 grid gap-3">
            {drafts.map((d) => {
              const checks = (d.checks as { check: string; pass: boolean; detail: string }[] | null) ?? [];
              return (
                <div key={d.id} className="rounded-xl border p-3" style={{ borderColor: d.status === "blocked" ? "var(--danger)" : "var(--border-subtle)" }}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <b style={{ color: "var(--text-primary)" }}>{KIND_LABEL[d.kind as MessageKind] ?? d.kind}</b>
                    <span className="muted">v{d.version}</span>
                    <span style={{ color: d.status === "blocked" ? "var(--danger-strong)" : d.status === "approved" ? "var(--success-strong)" : "var(--text-secondary)" }}>{d.status === "blocked" ? "Blocked by a check" : d.status === "approved" ? `Approved${d.approvedBy ? ` by ${d.approvedBy}` : ""}` : "Draft"}</span>
                  </div>
                  {d.why && <p className="muted mb-2 text-xs">Why: {d.why}</p>}
                  <ActionForm action={editLinkedInAction.bind(null, d.id)} className="grid gap-2" resetOnSuccess={false}>
                    <textarea name="body" defaultValue={d.body} rows={4} className="glass-textarea text-sm" aria-label="Message text" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="muted text-xs">{d.body.length} characters</span>
                      <SubmitButton className="btn btn-ghost btn-sm">Save edits</SubmitButton>
                      <CopyButton text={d.body} />
                      {d.status === "draft" && <ActionButton action={approveLinkedInAction.bind(null, d.id)} className="btn btn-secondary btn-sm"><CheckCircle2 size={13} /> Approve</ActionButton>}
                      <ActionButton action={discardLinkedInAction.bind(null, d.id)} className="btn btn-ghost btn-sm"><XCircle size={13} /> Discard</ActionButton>
                    </div>
                  </ActionForm>
                  <ul className="mt-2 grid gap-0.5 text-xs">
                    {checks.map((c) => <li key={c.check} style={{ color: c.pass ? "var(--text-secondary)" : "var(--danger-strong)" }}><ShieldCheck size={11} className="mr-1 inline" aria-hidden />{c.check}: {c.detail}</li>)}
                  </ul>
                  {d.status !== "blocked" && (
                    <ActionForm action={markSentLinkedInAction.bind(null, d.id)} className="mt-2 flex flex-wrap items-end gap-2" resetOnSuccess={false}>
                      <input type="hidden" name="sentText" value={d.body} />
                      <label className="grid gap-1 text-xs">Sent on<input type="date" name="sentOn" defaultValue={day(new Date())} className="glass-input" /></label>
                      <SubmitButton className="btn btn-brand btn-sm">I sent this on LinkedIn</SubmitButton>
                      <span className="muted text-xs">Save your edits first: the saved text is what's recorded.</span>
                    </ActionForm>
                  )}
                </div>
              );
            })}
            {drafts.length === 0 && <p className="muted text-xs">No draft yet. Pick a type and generate; every draft is checked against the research before you can approve it.</p>}
          </div>
        </section>
      </div>

      {/* Replies */}
      <section className="mt-6">
        <H>Their reply</H>
        <ActionForm action={recordLinkedInReplyAction.bind(null, journeyId)} className="grid gap-2">
          <textarea name="reply" rows={3} className="glass-textarea text-sm" placeholder="Paste their LinkedIn reply here" required />
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs">Received on<input type="date" name="receivedOn" defaultValue={day(new Date())} className="glass-input" /></label>
            <SubmitButton className="btn btn-secondary btn-sm">Analyse reply</SubmitButton>
          </div>
        </ActionForm>
        {pending.map((m) => {
          const a = m.analysis as unknown as ReplyAnalysis;
          return (
            <div key={m.id} className="mt-3 rounded-xl border p-3 text-xs" style={{ borderColor: "var(--border-subtle)" }}>
              <p className="secondary mb-2 whitespace-pre-wrap">“{m.body}”</p>
              <div className="grid gap-1">
                <div><b>Reading:</b> {TYPE_LABEL[a.type] ?? a.type} · {INTENT_LABEL[a.intent]}{a.futureOpportunity ? " · possible future opportunity" : ""}{a.stopRequested ? " · asked to stop" : ""}</div>
                {a.questions.length > 0 && <div><b>Questions to answer:</b> {a.questions.join(" · ")}</div>}
                {a.mentions.length > 0 && <div><b>Mentions:</b> {a.mentions.join(" · ")}</div>}
                {a.commitments.length > 0 && <div><b>Commitments:</b> {a.commitments.join(" · ")}</div>}
                <div><b>Recommended:</b> {a.recommendedAction}{a.followUpOn ? ` (reconnect ${a.followUpOn})` : ""}</div>
              </div>
              <ActionForm action={confirmLinkedInReplyAction.bind(null, m.id)} className="mt-2 flex flex-wrap items-end gap-2">
                <label className="grid gap-1">What it means
                  <select name="stage" defaultValue={a.suggestedStage} className="glass-input">{JOURNEY_STAGES.map((s) => <option key={s} value={s}>{STAGE_INFO[s].label}</option>)}</select>
                </label>
                <SubmitButton className="btn btn-primary btn-sm">Confirm</SubmitButton>
                <span className="muted">Confirming moves the journey; a positive reply starts the sales hand-off, a stop request stops all outreach.</span>
              </ActionForm>
            </div>
          );
        })}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Conversation timeline */}
        <section>
          <H>Conversation timeline</H>
          {timeline.length === 0 ? <p className="muted text-xs">Nothing recorded yet.</p> : (
            <ol className="grid gap-2 text-xs">
              {timeline.map((m) => (
                <li key={m.id} className="rounded-lg px-3 py-2" style={{ background: m.direction === "out" ? "var(--surface-card-header)" : "var(--indigo-bg)" }}>
                  <div className="muted mb-0.5">{m.direction === "out" ? `You · ${KIND_LABEL[m.kind as MessageKind] ?? m.kind}` : `${w.c.firstName ?? w.c.fullName}`} · {day(m.occurredAt ?? m.createdAt)}{m.sentBy ? ` · recorded by ${m.sentBy}` : ""}</div>
                  <div className="secondary whitespace-pre-wrap">{m.sentText ?? m.body}</div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Conversation summary */}
        <section>
          <div className="flex items-center justify-between"><H>Conversation summary</H><ActionButton action={refreshSummaryAction.bind(null, journeyId)} className="btn btn-ghost btn-sm"><RefreshCw size={12} /> Rebuild</ActionButton></div>
          {!summary ? <p className="muted text-xs">Built from the recorded messages after the first send or reply. The messages above stay the record.</p> : (
            <ActionForm action={correctSummaryAction.bind(null, journeyId)} className="grid gap-2 text-xs" resetOnSuccess={false}>
              {w.j.summaryEditedBy && <span className="muted">Corrected by {w.j.summaryEditedBy}</span>}
              <label className="grid gap-0.5">Stage<input name="stage" defaultValue={summary.stage} className="glass-input" /></label>
              <label className="grid gap-0.5">Last interaction<input name="lastInteraction" defaultValue={summary.lastInteraction} className="glass-input" /></label>
              <label className="grid gap-0.5">Topics (one per line)<textarea name="topics" defaultValue={summary.topics.join("\n")} rows={2} className="glass-textarea" /></label>
              <label className="grid gap-0.5">Their concerns<textarea name="concerns" defaultValue={summary.concerns.join("\n")} rows={2} className="glass-textarea" /></label>
              <label className="grid gap-0.5">Interest<input name="interest" defaultValue={summary.interest} className="glass-input" /></label>
              <label className="grid gap-0.5">Commitments<textarea name="commitments" defaultValue={summary.commitments.join("\n")} rows={2} className="glass-textarea" /></label>
              <label className="grid gap-0.5">Next step<input name="nextStep" defaultValue={summary.nextStep} className="glass-input" /></label>
              <label className="grid gap-0.5">Next action date<input type="date" name="nextDate" defaultValue={summary.nextDate ?? ""} className="glass-input" /></label>
              <div className="flex justify-end"><SubmitButton className="btn btn-ghost btn-sm">Save correction</SubmitButton></div>
            </ActionForm>
          )}
        </section>
      </div>
    </Card>
  );
}
