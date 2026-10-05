import Link from "next/link";
import { notFound } from "next/navigation";
import type { FieldStatus } from "@prisma/client";
import { AlertTriangle, ArrowLeft, ExternalLink, FileText, Handshake, Lightbulb, Play, RotateCcw, ShieldAlert, Users } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG, STAGES } from "@/lib/config";
import type { TwinSnapshot } from "@/lib/pipeline/stages/research";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { Avatar, Badge, Card, Empty, FieldBadge, Kpi, Meter, StageBadge, TabLinks, TierBadge, ago, date, money } from "@/components/ui";
import { addNoteAction, manualHandoffAction, runAccountAction, updateAccountAction } from "../../actions";

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const a = await db.account.findUnique({
    where: { id },
    include: {
      owner: true,
      contacts: { where: { mergedIntoId: null }, include: { fieldStates: true, drafts: { orderBy: { createdAt: "desc" } } }, orderBy: [{ buyingRole: "asc" }, { fullName: "asc" }] },
      opportunities: { orderBy: { createdAt: "desc" } },
      twins: { orderBy: { version: "desc" }, take: 1 },
      plans: { orderBy: { createdAt: "desc" }, take: 1 },
      notes: { orderBy: { createdAt: "desc" }, include: { author: true } },
      tasks: { orderBy: { createdAt: "desc" }, include: { assignee: true } },
      watchlist: { where: { status: "waiting" } },
      reviewItems: { where: { status: "open" } },
      _count: { select: { events: true, signals: true } },
    },
  });
  if (!a) notFound();
  if (a.mergedIntoId) {
    return (
      <Card className="page-enter">
        <Empty title={`${a.name} was merged`} sub="Duplicates are merged, never deleted." action={<Link className="btn btn-primary btn-sm" href={`/accounts/${a.mergedIntoId}`}>Open the kept record</Link>} />
      </Card>
    );
  }

  const [ledger, events, signals, users] = await Promise.all([
    db.ledgerEntry.aggregate({ where: { accountId: id }, _sum: { amountMicros: true } }),
    tab === "pipeline" ? db.pipelineEvent.findMany({ where: { accountId: id }, orderBy: { createdAt: "desc" }, take: 300 }) : Promise.resolve([]),
    tab === "activity" || tab === "overview" ? db.signal.findMany({ where: { accountId: id }, orderBy: { occurredAt: "desc" }, take: 60, include: { contact: true } }) : Promise.resolve([]),
    db.user.findMany({ orderBy: { name: "asc" } }),
  ]);
  const spent = (ledger._sum.amountMicros ?? 0) / 1_000_000;
  const cap = CONFIG.budgetsUsd[a.tier ?? "T3"];
  const twin = a.twins[0]?.snapshot as unknown as TwinSnapshot | undefined;
  const stageName = STAGES.find((s) => s.n === a.pipelineStage)?.name ?? "Not started";
  const drafts = a.contacts.flatMap((c) => c.drafts.map((d) => ({ ...d, contact: c })));

  return (
    <div className="page-enter">
      <Link href="/accounts" className="btn btn-ghost btn-sm mb-3 -ml-2"><ArrowLeft size={14} /> Accounts</Link>

      <div className="glass-card-static card-pad mb-5 overflow-hidden" style={{ background: `linear-gradient(155deg, rgba(99,102,241,0.08), var(--surface-card) 55%)` }}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={a.name} id={a.id} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="page-title truncate">{a.name}</h1>
                <StageBadge stage={a.stage} />
                <TierBadge tier={a.tier} />
                {a.relationship !== "prospect" && <Badge color="#475569">{a.relationship}</Badge>}
              </div>
              <div className="mono muted mt-1 flex flex-wrap gap-x-3">
                {a.domain ? <a href={`https://${a.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">{a.domain}<ExternalLink size={11} /></a> : <span>no domain</span>}
                <span>{a.industry ?? "industry unknown"}</span>
                <span>{a.employees ? `${a.employees.toLocaleString()} employees` : "size unknown"}</span>
                <span>{a.country ?? "—"}</span>
                <span>owner: {a.owner?.name ?? "unassigned"}</span>
              </div>
              {a.disqualifyReason && <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#B45309" }}><AlertTriangle size={13} /> {a.disqualifyReason}</div>}
              {a.watchlist[0] && <div className="mt-2 text-xs secondary">On the watchlist: {a.watchlist[0].reason} · re-check {date(a.watchlist[0].recheckAt)}</div>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton action={runAccountAction.bind(null, a.id, undefined)} className="btn btn-brand" title="Continue from the next stage"><Play size={15} /> Run pipeline</ActionButton>
            <ActionButton action={runAccountAction.bind(null, a.id, 5)} className="btn btn-secondary" title="Re-plan and re-research (loop counters are kept)"><RotateCcw size={15} /> Re-research</ActionButton>
            <ActionButton action={manualHandoffAction.bind(null, a.id)} className="btn btn-secondary" confirm="Hand this account to its owner now? Automated outreach will pause."><Handshake size={15} /> Hand off</ActionButton>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Fit" value={a.fitScore ?? "—"} meta="Known fields only" />
          <Kpi label="Data confidence" value={a.dataConfidence != null ? `${Math.round(a.dataConfidence * 100)}%` : "—"} accent="#0D9488" meta="Verified share of what we hold" />
          <Kpi label="Intent" value={Math.round(a.intentScore)} accent="#0EA5E9" meta={a.intentScore >= CONFIG.intent.surgeThreshold ? "Surging" : "Baseline"} />
          <Kpi label="Engagement" value={Math.round(a.engagementScore)} accent="#7C3AED" meta={`MQA at ${CONFIG.engagement.stages.MQA}`} />
          <Kpi label="Pipeline stage" value={a.pipelineStage || "—"} accent={a.pipelineStatus === "blocked" ? "#F59E0B" : a.pipelineStatus === "error" ? "#DC2626" : "#10B981"} meta={`${stageName} · ${a.pipelineStatus}`} />
          <div className="kpi" style={{ ["--kpi-accent" as string]: spent / cap > 0.8 ? "#DC2626" : "#10B981" }}>
            <span className="micro">Budget</span>
            <div className="value display-num tnum">${spent.toFixed(2)}</div>
            <div className="mt-2"><Meter value={spent} max={cap} color={spent / cap > 0.8 ? "#DC2626" : "#10B981"} /></div>
            <div className="meta">of ${cap.toFixed(2)} ({a.tier ?? "T3"})</div>
          </div>
        </div>
      </div>

      <TabLinks
        base={`/accounts/${a.id}`}
        active={tab}
        tabs={[
          { id: "overview", label: "Evidence twin" },
          { id: "people", label: "Buying group", count: a.contacts.length },
          { id: "outreach", label: "Drafts", count: drafts.length },
          { id: "activity", label: "Activity & notes", count: a._count.signals + a.notes.length },
          { id: "crm", label: "CRM", count: a.opportunities.length + a.tasks.length },
          { id: "pipeline", label: "Audit trail", count: a._count.events },
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="grid gap-5 xl:col-span-2">
            <Card title="Facts" sub={twin ? `Twin v${a.twins[0].version} · ${date(a.twins[0].createdAt)} · every fact keeps a status and a source` : undefined}>
              {!twin || twin.facts.length === 0 ? <Empty icon={<FileText size={20} />} title="No evidence yet" sub="Run the pipeline to research this account." /> : (
                <ul className="grid gap-2.5">
                  {twin.facts.map((f) => (
                    <li key={f.id} className="rounded-xl px-3.5 py-3" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="text-sm" style={{ color: "var(--text-primary)" }}>{f.claim}</span>
                        <FieldBadge status={f.status as FieldStatus} />
                      </div>
                      <div className="mono muted mt-1.5 flex flex-wrap gap-x-3">
                        <span className="micro" style={{ letterSpacing: "0.06em" }}>{f.key.replace("_", " ")}</span>
                        <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">{f.sourceType} · {new URL(f.sourceUrl).hostname}</a>
                        <span>{date(f.publishedAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {twin && twin.inferences.length > 0 && (
              <Card title="Inferences" sub="Labelled as inference — never stated as fact in a draft">
                <ul className="grid gap-2">
                  {twin.inferences.map((i, k) => (
                    <li key={k} className="flex gap-2.5 text-sm secondary"><Lightbulb size={16} className="mt-0.5 shrink-0" style={{ color: "#8B5CF6" }} /><span>{i.text} <span className="muted text-xs">· based on {i.basedOn.length} fact{i.basedOn.length > 1 ? "s" : ""}</span></span></li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
          <div className="grid content-start gap-5">
            <Card title="Unknowns & risks">
              <div className="grid gap-3 text-sm">
                <div>
                  <div className="micro mb-1.5">Still unknown</div>
                  {twin?.unknowns.length ? <div className="flex flex-wrap gap-1.5">{twin.unknowns.map((u) => <Badge key={u} color="#64748B">{u.replace("_", " ")}</Badge>)}</div> : <span className="muted text-xs">Nothing open</span>}
                </div>
                <div>
                  <div className="micro mb-1.5">Negative evidence</div>
                  {twin?.negatives.length ? twin.negatives.map((n) => <div key={n.id} className="flex items-center gap-2 text-xs" style={{ color: "#B45309" }}><ShieldAlert size={14} />{n.claim} · {date(n.publishedAt)}</div>) : <span className="muted text-xs">{twin?.noNegativeNews ? "Checked — no negative news (counts as an answer)" : "Not checked yet"}</span>}
                </div>
                <div>
                  <div className="micro mb-1.5">Contradictions</div>
                  {twin?.contradictions.length ? twin.contradictions.map((c) => <div key={c.key} className="text-xs secondary"><b style={{ color: "var(--text-primary)" }}>{c.key}</b>: {c.values.join(" vs ")} — {c.resolution}</div>) : <span className="muted text-xs">None</span>}
                </div>
                {twin?.changed.length ? (
                  <div>
                    <div className="micro mb-1.5">Changed in this version</div>
                    <ul className="grid gap-1 text-xs secondary">{twin.changed.slice(0, 6).map((c, i) => <li key={i}>· {c}</li>)}</ul>
                  </div>
                ) : null}
              </div>
            </Card>
            <Card title="Research plan" sub={a.plans[0] ? `${a.plans[0].reason} · ${ago(a.plans[0].createdAt)}` : undefined}>
              {!a.plans[0] ? <span className="muted text-xs">No plan yet</span> : (
                <div className="grid gap-2 text-xs">
                  {(a.plans[0].questions as { key: string; importance: string }[]).map((q) => <div key={q.key} className="flex items-center justify-between"><span className="secondary">{q.key.replace("_", " ")}</span><Badge color={q.importance === "high" ? "#DC2626" : "#B45309"}>{q.importance}</Badge></div>)}
                  {(a.plans[0].skipped as { key: string; reason: string }[]).map((s) => <div key={s.key} className="muted">Skipped {s.key.replace("_", " ")}: {s.reason}</div>)}
                </div>
              )}
            </Card>
            {a.reviewItems.length > 0 && (
              <Card title="Open review items">
                <ul className="grid gap-2 text-xs secondary">{a.reviewItems.map((r) => <li key={r.id}><b style={{ color: "var(--text-primary)" }}>{r.type.replaceAll("_", " ")}</b> — {r.reason}</li>)}</ul>
                <Link href="/review" className="btn btn-secondary btn-sm mt-3">Open review queue</Link>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "people" && (
        <Card pad={false} title="Buying group" sub="Found by the function that owns the problem, not by seniority. Field statuses come from stage 4 and enrichment.">
          {a.contacts.length === 0 ? <Empty icon={<Users size={20} />} title="No contacts" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Person</th><th>Role</th><th>Email</th><th>Title</th><th>Company</th><th>Identity</th><th>Readiness</th><th>State</th></tr></thead>
                <tbody>
                  {a.contacts.map((c) => {
                    const fs = Object.fromEntries(c.fieldStates.map((f) => [f.field, f.status])) as Record<string, FieldStatus>;
                    return (
                      <tr key={c.id}>
                        <td className="strong">
                          <div className="flex items-center gap-2.5"><Avatar name={c.fullName} id={c.id} size={30} round />
                            <div><div>{c.fullName}</div><div className="muted text-xs font-normal">{c.titleNormalized ?? c.title ?? "—"}</div><div className="mono muted text-[0.7rem] font-normal">{c.email ?? "no email"}</div></div>
                          </div>
                        </td>
                        <td><Badge color={c.buyingRole === "decision_maker" ? "#4F46E5" : c.buyingRole === "champion" ? "#0D9488" : "#64748B"}>{c.buyingRole.replace("_", " ")}</Badge></td>
                        <td><FieldBadge status={fs.email} /></td>
                        <td><FieldBadge status={fs.title} /></td>
                        <td><FieldBadge status={fs.company} /></td>
                        <td className="tnum">{c.identityConfidence != null ? `${Math.round(c.identityConfidence * 100)}%` : "—"}</td>
                        <td>{c.readiness ? <span title={c.readinessReasons.join("; ")}><Badge color={c.readiness === "ready" ? "#059669" : c.readiness === "human_review" ? "#7C3AED" : c.readiness === "disqualified" ? "#DC2626" : "#B45309"}>{c.readiness.replaceAll("_", " ")}</Badge></span> : <span className="muted">—</span>}</td>
                        <td><span className="text-xs">{c.state.replace("_", " ")}</span>{c.lawfulBasis && <div className="muted max-w-[180px] truncate text-[0.7rem]" title={c.lawfulBasis}>{c.lawfulBasis}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "outreach" && (
        <div className="grid gap-4">
          {drafts.length === 0 ? <Card><Empty icon={<FileText size={20} />} title="No drafts yet" sub="Drafts appear once a person passes the readiness gate." /></Card> : drafts.map((d) => (
            <Card key={d.id} title={d.subject} sub={`${d.contact.fullName} · step ${d.stepOrder} · ${ago(d.createdAt)}`} action={<Badge color={d.status === "sent" ? "#059669" : d.status === "approved" ? "#0EA5E9" : d.status === "pending_review" ? "#8B5CF6" : "#DC2626"}>{d.status.replace("_", " ")}</Badge>}>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed secondary">{d.body || d.blockReason}</pre>
              {d.reviewerNote && <div className="muted mt-3 text-xs">Reviewer: {d.reviewerNote}</div>}
            </Card>
          ))}
        </div>
      )}

      {tab === "activity" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Signals" sub="Account-level: anonymous and uncontacted activity counts at reduced weight">
            {signals.length === 0 ? <Empty title="No signals yet" /> : (
              <ul className="timeline">
                {signals.map((s) => (
                  <li key={s.id} className="tl-item" style={{ ["--tl" as string]: s.anonymous ? "#0EA5E9" : s.attributed ? "#7C3AED" : "#94A3B8" }}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span style={{ color: "var(--text-primary)" }}><b>{s.type.replaceAll("_", " ")}</b> <span className="secondary">{s.contact ? `· ${s.contact.fullName}` : "· anonymous"}{s.detail ? ` · ${s.detail}` : ""}</span></span>
                      <span className="mono muted whitespace-nowrap">+{s.points} · {ago(s.occurredAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Notes">
            <ActionForm action={addNoteAction} className="mb-4 grid gap-2">
              <input type="hidden" name="accountId" value={a.id} />
              <textarea name="body" className="glass-textarea" placeholder="Add a note for the team…" required />
              <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Add note</SubmitButton></div>
            </ActionForm>
            <ul className="grid gap-3">
              {a.notes.map((n) => (
                <li key={n.id} className="rounded-xl px-3.5 py-3 text-sm" style={{ background: "var(--surface-card-header)" }}>
                  <div className="secondary whitespace-pre-wrap">{n.body}</div>
                  <div className="muted mt-1.5 text-xs">{n.author?.name ?? "System"} · {ago(n.createdAt)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "crm" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card title="Opportunities" className="xl:col-span-2" action={<Link href={`/crm/opportunities?account=${a.id}`} className="btn btn-secondary btn-sm">Manage</Link>}>
            {a.opportunities.length === 0 ? <Empty title="No opportunities" sub="Create one from CRM · Opportunities. Opening a deal pauses automated outreach." /> : (
              <ul className="grid gap-2">
                {a.opportunities.map((o) => (
                  <li key={o.id} className="flex items-center justify-between rounded-xl px-3.5 py-3" style={{ background: "var(--surface-card-header)" }}>
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{o.name}</span>
                    <span className="flex items-center gap-3"><span className="tnum text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{money(o.amountUsd)}</span><Badge color={o.stage === "won" ? "#059669" : o.stage === "lost" ? "#DC2626" : "#4F46E5"}>{o.stage}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
            <div className="micro mb-2 mt-6">Tasks</div>
            {a.tasks.length === 0 ? <span className="muted text-xs">No tasks</span> : (
              <ul className="grid gap-1.5 text-sm">{a.tasks.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className={t.status === "done" ? "muted line-through" : "secondary"}>{t.title}</span><span className="muted text-xs">{t.assignee?.name ?? "—"} · {t.dueAt ? date(t.dueAt) : "no date"}</span></li>)}</ul>
            )}
          </Card>
          <Card title="Account settings" sub="Changes take effect on the next pipeline run">
            <ActionForm action={updateAccountAction} className="grid gap-3" resetOnSuccess={false}>
              <input type="hidden" name="id" value={a.id} />
              <div><label className="field-label" htmlFor="rel">Relationship</label>
                <select id="rel" name="relationship" defaultValue={a.relationship} className="glass-select">{["prospect", "customer", "competitor", "partner"].map((r) => <option key={r} value={r}>{r}</option>)}</select>
              </div>
              <div><label className="field-label" htmlFor="owner">Owner</label>
                <select id="owner" name="ownerId" defaultValue={a.ownerId ?? ""} className="glass-select"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select>
              </div>
              <div><label className="field-label" htmlFor="tier">Tier override</label>
                <select id="tier" name="tier" defaultValue={a.tier ?? "auto"} className="glass-select"><option value="auto">Automatic from fit</option><option value="T1">T1 · 1:1</option><option value="T2">T2 · 1:few</option><option value="T3">T3 · 1:many</option></select>
              </div>
              <label className="flex items-center gap-2 text-sm secondary"><input type="checkbox" name="doNotContact" defaultChecked={a.doNotContact} className="h-4 w-4 accent-indigo-500" /> Do not contact (owner request)</label>
              <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Save</SubmitButton></div>
            </ActionForm>
          </Card>
        </div>
      )}

      {tab === "pipeline" && (
        <Card title="Audit trail" sub="Every gate decision, newest first. Nothing is dropped silently.">
          {events.length === 0 ? <Empty title="No events" /> : (
            <ul className="timeline">
              {events.map((e) => (
                <li key={e.id} className="tl-item" style={{ ["--tl" as string]: e.outcome === "block" ? "#F59E0B" : e.outcome === "error" ? "#DC2626" : e.outcome === "pass" ? "#10B981" : "#94A3B8" }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm"><span className="mono muted mr-2">{e.step}</span><span className="secondary">{e.reason}</span></span>
                    <span className="mono muted whitespace-nowrap">s{e.stage} · {e.outcome} · {ago(e.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
