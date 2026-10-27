import Link from "next/link";
import { notFound } from "next/navigation";
import type { FieldStatus } from "@prisma/client";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Flag, Handshake, Pencil, Lightbulb, Play, RotateCcw, ShieldAlert, Users, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { PIPELINE_STATUS_LABEL, PROGRESS_LABEL } from "@/lib/stage-docs";
import { ensureSellerPacks, seller, sellerFor } from "@/lib/seller";
import type { TwinSnapshot } from "@/lib/pipeline/stages/research";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { Avatar, Badge, Card, Empty, FieldBadge, Kpi, Meter, StageBadge, TabLinks, TierBadge, ago, date, money } from "@/components/ui";
import { addNoteAction, correctFactAction, flagFactAction, manualHandoffAction, runAccountAction, unflagFactAction, updateAccountAction } from "../../actions";
import { latestBrief } from "@/lib/brain/strategist";
import { FamilyChip, IntentPill, NextAction, StatStrip, type IntentLevel } from "@/components/v2";
const VERDICT_COLOR = { strong: "#059669", moderate: "#B45309", weak: "#64748B" } as const;
import { IntakeTab } from "./intake-tab";
import { Crumbs } from "@/components/shell/Crumbs";
import { PipelineStepper, accountStep } from "@/components/peek/stepper";
const TAB_LABEL: Record<string, string> = { intake: "Data → research", people: "Buying group", outreach: "Drafts", activity: "Activity & notes", crm: "CRM", pipeline: "Audit trail" };
import { WebVisitsCard } from "@/components/web-visits";
import { AddTaskButton } from "@/components/shell/QuickTask";
import { BuyingGroupPlan } from "./buying-group";
import { TimelineCard } from "./timeline-card";
import { NetworkCard } from "./network-card";
import { HeaderSignals, WhyNow } from "./header-signals";

const PALETTE = ["#6366F1", "#0EA5E9", "#10B981", "#F59E0B", "#F472B6", "#8B5CF6", "#06B6D4", "#EF4444"];
function brandColor(id: string) {
  let h = 0;
  for (const c of id) h = c.charCodeAt(0) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/** Priority 0–100 as a ring: purple→indigo arc on a soft track, the number in Fraunces. */
function PriorityRing({ score }: { score: number | null }) {
  const r = 46, c = 2 * Math.PI * r, v = score ?? 0;
  return (
    <div className="co-ring-svg">
      <svg viewBox="0 0 108 108" width="108" height="108" aria-hidden>
        <defs><linearGradient id="co-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7C3AED" /><stop offset="1" stopColor="#4F46E5" /></linearGradient></defs>
        <circle cx="54" cy="54" r={r} fill="none" stroke="var(--accent-primary-soft, rgba(124,58,237,0.1))" strokeWidth="9" />
        {v > 0 && <circle cx="54" cy="54" r={r} fill="none" stroke="url(#co-ring)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 54 54)" />}
      </svg>
      <span className="co-ring-n tnum">{score ?? "—"}</span>
      <span className="co-ring-l">Priority</span>
    </div>
  );
}

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await ensureSellerPacks();
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

  const [ledger, events, signals, users, brief, flagged, engines] = await Promise.all([
    db.ledgerEntry.aggregate({ where: { accountId: id }, _sum: { amountMicros: true } }),
    tab === "pipeline" ? db.pipelineEvent.findMany({ where: { accountId: id }, orderBy: { createdAt: "desc" }, take: 300 }) : Promise.resolve([]),
    tab === "activity" || tab === "overview" ? db.signal.findMany({ where: { accountId: id }, orderBy: { occurredAt: "desc" }, take: 60, include: { contact: true } }) : Promise.resolve([]),
    db.user.findMany({ orderBy: { name: "asc" } }),
    latestBrief(id),
    db.evidence.findMany({ where: { accountId: id, flagged: true }, orderBy: { createdAt: "desc" } }),
    db.evidence.findMany({ where: { accountId: id }, select: { id: true, engine: true } }),
  ]);
  const engineOf = new Map(engines.map((e) => [e.id, e.engine]));
  const flaggedIds = new Set(flagged.map((f) => f.id));
  const spent = (ledger._sum.amountMicros ?? 0) / 1_000_000;
  const sp = (() => { try { return sellerFor(a.sellerId); } catch { return seller(); } })();
  const cap = CONFIG.budgetsUsd[a.tier ?? "T3"];
  const twin = a.twins[0]?.snapshot as unknown as TwinSnapshot | undefined;
  const stageName = PROGRESS_LABEL[a.pipelineStage] ?? "Not started";
  const reading = a.intentReading as unknown as { score: number; level: IntentLevel; whyNow: string | null; families: string[]; explain: string } | null;
  const drafts = a.contacts.flatMap((c) => c.drafts.map((d) => ({ ...d, contact: c })));

  return (
    <div className="page-enter">
      <Crumbs items={[{ label: "Companies", href: "/accounts" }, { label: a.name, href: tab !== "overview" ? `/accounts/${a.id}` : undefined }, ...(tab !== "overview" ? [{ label: TAB_LABEL[tab] ?? tab }] : [])]} />

      <section className="co-hero" style={{ ["--co" as string]: brandColor(a.id) }}>
        <div className="co-top">
          <div className="co-id">
            <Avatar name={a.name} id={a.id} size={64} />
            <div className="min-w-0">
              <div className="co-kicker">{[a.industry ?? "Industry unknown", [a.city, a.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</div>
              <h1 className="co-name">{a.name}</h1>
              <div className="co-badges">
                <StageBadge stage={a.stage} />
                <TierBadge tier={a.tier} />
                {a.relationship !== "prospect" && <Badge color="#475569">{a.relationship}</Badge>}
                {a.domain && <a href={`https://${a.domain}`} target="_blank" rel="noreferrer" className="co-link">{a.domain}<ExternalLink size={11} /></a>}
                {a.linkedinUrl && <a href={a.linkedinUrl} target="_blank" rel="noreferrer" className="co-link">LinkedIn<ExternalLink size={11} /></a>}
              </div>
            </div>
          </div>
          <div className="co-actions">
            <ActionButton action={runAccountAction.bind(null, a.id, undefined)} className="btn btn-brand" title="Continue from the next stage"><Play size={15} /> Run pipeline</ActionButton>
            <ActionButton action={runAccountAction.bind(null, a.id, 5)} className="btn btn-secondary" title="Re-plan and re-research (loop counters are kept)"><RotateCcw size={15} /> Re-research</ActionButton>
            <ActionButton action={manualHandoffAction.bind(null, a.id)} className="btn btn-secondary" confirm="Hand this account to its owner now? Automated outreach will pause."><Handshake size={15} /> Hand off</ActionButton>
            <AddTaskButton target={{ accountId: a.id, label: a.name }} className="btn btn-secondary" />
          </div>
        </div>

        <div className="co-body">
          <div className="co-ring" title="Priority: intent, fit, value and timing">
            <PriorityRing score={a.priorityScore} />
            {(() => { const pp = a.priorityParts as { intent: number; fit: number; value: number; timing: number } | null; return pp ? (
              <ul className="co-parts">
                {([["Intent", pp.intent, "#F43F5E"], ["Fit", pp.fit, "#6366F1"], ["Value", pp.value, "#10B981"], ["Timing", pp.timing, "#F59E0B"]] as const).map(([l, v, c]) => (
                  <li key={l}><span>{l}</span><span className="co-part-bar"><i style={{ width: `${v}%`, background: c }} /></span><b className="tnum">{v}</b></li>
                ))}
              </ul>
            ) : <p className="co-muted">Scored after research · fit {a.fitScore ?? "—"}</p>; })()}
          </div>

          <div className="co-intent">
            <div className="co-label">Buying intent</div>
            {reading ? (
              <>
                <div className="co-intent-row"><IntentPill level={reading.level} score={reading.score} title={reading.explain} />{reading.families.map((f) => <FamilyChip key={f} family={f} />)}</div>
                <WhyNow brief={brief} fallback={reading.whyNow} />
              </>
            ) : <p className="co-muted">No buying signals read yet.</p>}
            {brief?.nextBestAction && <div className="mt-3"><NextAction text={brief.nextBestAction} why={brief.verdictWhy} /></div>}
            {a.disqualifyReason && <div className="co-warn"><AlertTriangle size={13} /> {a.disqualifyReason}</div>}
            {a.watchlist[0] && <div className="co-muted mt-2">On the watchlist: {a.watchlist[0].reason} · re-check {date(a.watchlist[0].recheckAt)}</div>}
          </div>

          <dl className="co-facts">
            <div><dt>Employees</dt><dd className="tnum">{a.employees ? a.employees.toLocaleString() : "—"}</dd></div>
            <div><dt>Owner</dt><dd>{a.owner?.name ?? "Unassigned"}</dd></div>
            <div><dt>Progress</dt><dd>{stageName}<small>{PIPELINE_STATUS_LABEL[a.pipelineStatus] ?? a.pipelineStatus}</small></dd></div>
            {a.technologies.length > 0 && <div className="wide"><dt>Stack</dt><dd>{a.technologies.join(", ")}</dd></div>}
          </dl>
        </div>

        <HeaderSignals account={a} brief={brief} intent={reading ? { score: reading.score, level: reading.level } : null} />

        {(a.keywords.length > 0 || a.companyNotes) && (
          <div className="co-foot">
            {a.keywords.slice(0, 14).map((k) => <span key={k} className="co-tag">{k}</span>)}
            {a.companyNotes && <p className="co-muted w-full">{a.companyNotes}</p>}
          </div>
        )}
        <div className="co-stepper"><PipelineStepper current={accountStep(a, { drafts: drafts.filter((d) => d.status === "pending_review").length, handoff: a.stage === "MQA" || a.stage === "OPPORTUNITY" })} stopped={a.pipelineStatus === "blocked" ? a.disqualifyReason ?? "Stopped at a check" : null} /></div>
      </section>

      <TabLinks
        base={`/accounts/${a.id}`}
        active={tab}
        tabs={[
          { id: "overview", label: "Evidence twin" },
          { id: "intake", label: "Data → research" },
          { id: "people", label: "Buying group", count: a.contacts.length },
          { id: "outreach", label: "Drafts", count: drafts.length },
          { id: "activity", label: "Activity & notes", count: a._count.signals + a.notes.length },
          { id: "crm", label: "CRM", count: a.opportunities.length + a.tasks.length },
          { id: "pipeline", label: "Audit trail", count: a._count.events },
        ]}
      />

      {tab === "overview" && <div className="mb-5"><TimelineCard accountId={a.id} /></div>}
      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="grid gap-5 xl:col-span-2">
            <Card title="Facts" sub={twin ? `Twin v${a.twins[0].version} · ${date(a.twins[0].createdAt)} · every fact keeps a status and a source` : undefined}>
              {!twin || twin.facts.length === 0 ? <Empty icon={<FileText size={20} />} title="No evidence yet" sub="Run the pipeline to research this account." /> : (
                <ul className="grid gap-2.5">
                  {twin.facts.filter((f) => !flaggedIds.has(f.id)).map((f) => (
                    <li key={f.id} className="rounded-xl px-3.5 py-3" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{f.claim}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <FieldBadge status={f.status as FieldStatus} />
                          <Modal trigger={<Pencil size={13} />} triggerClass="btn btn-ghost btn-sm" title="Correct this fact" eyebrow="Edit fact">
                            <ActionForm action={correctFactAction} className="grid gap-3">
                              <input type="hidden" name="evidenceId" value={f.id} />
                              <p className="muted text-xs">Now: &ldquo;{f.claim}&rdquo;</p>
                              <textarea name="claim" className="glass-textarea" defaultValue={f.claim} required aria-label="Corrected fact" />
                              <input name="sourceUrl" className="glass-input" placeholder="Source link (optional), e.g. https://company.com/news/…" aria-label="Source link" />
                              <p className="muted text-xs">The corrected fact is marked verified and used from now on. Unsent drafts that cited the old version are withdrawn.</p>
                              <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Save correction</SubmitButton></div>
                            </ActionForm>
                          </Modal>
                          <Modal trigger={<Flag size={13} />} triggerClass="btn btn-ghost btn-sm" title="Mark this fact as wrong" eyebrow="Feedback">
                            <ActionForm action={flagFactAction} className="grid gap-3">
                              <input type="hidden" name="evidenceId" value={f.id} />
                              <p className="secondary text-sm">&ldquo;{f.claim}&rdquo;</p>
                              <p className="muted text-xs">It stops being used at once, unsent drafts that cite it are withdrawn, and it counts against the engine that found it.</p>
                              <textarea name="reason" className="glass-textarea" placeholder="What is wrong? e.g. different company with a similar name, outdated, misread" required />
                              <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Mark wrong</SubmitButton></div>
                            </ActionForm>
                          </Modal>
                        </span>
                      </div>
                      <div className="mono muted mt-1.5 flex flex-wrap gap-x-3">
                        <span className="micro" style={{ letterSpacing: "0.06em" }}>{f.key.replace("_", " ")}</span>
                        {f.sourceType === "team" ? <span>Corrected by the team</span> : <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">{f.sourceType} · {new URL(f.sourceUrl).hostname}</a>}
                        <span>{date(f.publishedAt)}</span>
                        {engineOf.get(f.id) && <span>via {engineOf.get(f.id)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {flagged.length > 0 && (
              <Card title="Marked wrong" sub="Never used in drafts; kept so the same source isn't picked up again">
                <ul className="grid gap-2">
                  {flagged.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                      <span className="muted line-through">{f.claim}</span>
                      <span className="flex items-center gap-2"><span className="muted text-xs">{f.flagReason}</span><ActionButton action={unflagFactAction.bind(null, f.id)} className="btn btn-ghost btn-sm">Restore</ActionButton></span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
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
            {brief && (
              <Card title="Account summary" sub="Written automatically from the sourced facts">
                <Badge color={VERDICT_COLOR[brief.verdict]} dot>{brief.verdict}</Badge>
                <p className="secondary mt-2 text-sm">{brief.verdictWhy}</p>
                {brief.painPoints[0] && <p className="mt-2 text-xs secondary"><b style={{ color: "var(--text-primary)" }}>Top pain:</b> {brief.painPoints[0].pain}</p>}
                <p className="mt-2 text-xs secondary"><b style={{ color: "var(--text-primary)" }}>Next:</b> {brief.nextBestAction}</p>
              </Card>
            )}
            <div id="fit" className="contents" />
            <Card title={`Why fit ${a.fitScore ?? "—"} for ${sp.name}`} sub={a.useCase ? `Lead with: ${sp.useCases.find((u) => u.key === a.useCase)?.name ?? a.useCase}` : "Scored against the seller profile"}>
              {a.fitReasons.length === 0 ? <span className="muted text-xs">Run the pipeline to score this account.</span> : (
                <ul className="grid gap-3">
                  {a.fitReasons.map((r) => {
                    const m = r.match(/^([^:]+): (unknown|(\d+)\/(\d+)) — (.*)$/);
                    if (!m) return <li key={r} className="text-xs secondary">{r}</li>;
                    const [, label, , got, max, why] = m;
                    return (
                      <li key={r}>
                        <div className="mb-1 flex justify-between gap-2 text-xs"><span className="font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span><span className="tnum muted">{got ? `${got}/${max}` : "unknown"}</span></div>
                        {got && <Meter value={Number(got)} max={Number(max)} color={Number(got) / Number(max) >= 0.7 ? "#10B981" : Number(got) / Number(max) >= 0.4 ? "#F59E0B" : "#EF4444"} />}
                        <div className="muted mt-1 text-[0.72rem]">{why}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {a.useCase && <p className="secondary mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: "var(--surface-card-header)" }}>{sp.useCases.find((u) => u.key === a.useCase)?.pains}</p>}
            </Card>
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

      {tab === "intake" && <IntakeTab account={a} />}

      {tab === "people" && <NetworkCard accountId={a.id} company={a.name} />}
      {tab === "people" && <BuyingGroupPlan accountId={a.id} />}
      {tab === "people" && (
        <Card pad={false} title="Buying group" sub="Found by the function that owns the problem, not by seniority. Field statuses come from stage 4 and enrichment." action={<Link href={`/people?q=${encodeURIComponent(a.name)}`} className="btn btn-secondary btn-sm">Journeys in People</Link>}>
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
                            <div><div><Link href={`/people/${c.id}`} className="hover:underline">{c.fullName}</Link></div><div className="muted text-xs font-normal">{c.titleNormalized ?? c.title ?? "—"}</div><div className="mono muted text-[0.7rem] font-normal">{c.email ?? "no email"}</div></div>
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
              {(d.painPoint || d.useCase) && (
                <div className="mb-3 rounded-xl px-3 py-2 text-xs secondary" style={{ background: "var(--surface-card-header)" }}>
                  <b style={{ color: "var(--text-primary)" }}>Angle:</b> {d.useCase ? (sp.useCases.find((u) => u.key === d.useCase)?.name ?? d.useCase) : "—"}{d.painPoint ? ` · ${d.painPoint}` : ""}
                </div>
              )}
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed secondary">{d.body || d.blockReason}</pre>
              {Array.isArray(d.claimCheck) && (
                <ul className="mt-3 grid gap-1">
                  {(d.claimCheck as { text: string; supported: boolean; reason: string }[]).map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs" style={{ color: c.supported ? "#059669" : "#DC2626" }}>
                      {c.supported ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <XCircle size={13} className="mt-0.5 shrink-0" />}
                      <span><span className="secondary">{c.text}</span> <span className="muted">— {c.reason}</span></span>
                    </li>
                  ))}
                </ul>
              )}
              {d.reviewerNote && <div className="muted mt-3 text-xs">Reviewer: {d.reviewerNote}</div>}
            </Card>
          ))}
        </div>
      )}

      {tab === "activity" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="xl:col-span-2"><WebVisitsCard accountId={a.id} /></div>
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
                <select id="tier" name="tier" defaultValue={a.tierLocked && a.tier ? a.tier : "auto"} className="glass-select"><option value="auto">Automatic from fit</option><option value="T1">T1 · 1:1</option><option value="T2">T2 · 1:few</option><option value="T3">T3 · 1:many</option></select>
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
