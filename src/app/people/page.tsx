import Link from "next/link";
import type { JourneyStage, Prisma } from "@prisma/client";
import { Eye, Pencil, Phone, Search, Trash2, Upload, Users } from "lucide-react";
import { db } from "@/lib/db";
import { JOURNEY_STAGES, STAGE_INFO, stageLabel, CLOSED } from "@/lib/journey/stages";
import { eligibleToCall, nextAction } from "@/lib/journey/engine";
import { ActionButton, ActionForm, SelectAll, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, PageHeader, ago, hexA } from "@/components/ui";
import { bulkUpdateAction, deletePersonAction } from "../actions";

export const metadata = { title: "People" };

const PAGE = 50;
const NOT_CALLABLE: JourneyStage[] = ["not_contacted", "connection_sent", ...CLOSED];

type SP = { q?: string; campaign?: string; sender?: string; stage?: string; call?: string; page?: string };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const stage = (JOURNEY_STAGES as readonly string[]).includes(sp.stage ?? "") ? (sp.stage as JourneyStage) : undefined;
  const scope: Prisma.JourneyWhereInput = { ...(sp.campaign ? { campaignId: sp.campaign } : {}), ...(sp.sender ? { senderId: sp.sender } : {}) };
  const scoped = Boolean(sp.campaign || sp.sender);

  // Every filter is its own clause so none overwrites another.
  const and: Prisma.ContactWhereInput[] = [{ mergedIntoId: null }];
  if (sp.q) and.push({ OR: [{ fullName: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }, { title: { contains: sp.q, mode: "insensitive" } }, { account: { name: { contains: sp.q, mode: "insensitive" } } }] });
  if (scoped || stage) and.push({ journeys: { some: { ...scope, ...(stage ? { stage } : {}) } } });
  if (sp.call === "yes") and.push({ phone: { not: null }, state: { notIn: ["suppressed", "do_not_contact"] }, account: { doNotContact: false }, journeys: { some: { ...scope, stage: { notIn: NOT_CALLABLE } } } });
  if (sp.call === "no") and.push({ OR: [{ phone: null }, { state: { in: ["suppressed", "do_not_contact"] } }, { account: { doNotContact: true } }, { journeys: { none: { ...scope, stage: { notIn: NOT_CALLABLE } } } }] });
  const where: Prisma.ContactWhereInput = { AND: and };

  const [people, total, campaigns, senders, stageCounts] = await Promise.all([
    db.contact.findMany({
      where,
      include: { account: { select: { id: true, name: true, doNotContact: true, stage: true, disqualifyReason: true } }, journeys: { where: scope, include: { sender: { select: { name: true } }, campaign: { select: { name: true } } }, orderBy: { updatedAt: "desc" } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.contact.count({ where }),
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    db.senderProfile.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.journey.groupBy({ by: ["stage"], where: scope, _count: true }),
  ]);
  const now = new Date();
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/people${p.toString() ? `?${p}` : ""}`;
  };
  const bulkReady = Boolean(sp.campaign && sp.sender);

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="People master"
        title="People"
        sub={`${total.toLocaleString()} ${total === 1 ? "person" : "people"}${scoped ? " in this campaign / sender" : ""}. One record per person; each sender profile keeps its own journey. Reply count is a metric — the reply's meaning sets the stage.`}
        actions={<Link href="/import" className="btn btn-brand"><Upload size={15} /> Import Companies &amp; People</Link>}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {JOURNEY_STAGES.map((k) => {
          const n = stageCounts.find((s) => s.stage === k)?._count ?? 0;
          const active = stage === k;
          return (
            <Link key={k} href={qs({ stage: active ? undefined : k, page: undefined })} className="badge" style={{ background: active ? hexA(STAGE_INFO[k].color, 0.2) : "var(--surface-card-header)", color: active ? STAGE_INFO[k].color : "var(--text-secondary)", border: `1px solid ${active ? STAGE_INFO[k].color : "transparent"}` }}>
              {STAGE_INFO[k].n}. {STAGE_INFO[k].label} <b className="tnum ml-1">{n}</b>
            </Link>
          );
        })}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/people">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input name="q" defaultValue={sp.q} placeholder="Name, email, title or company" className="glass-input" style={{ paddingLeft: 34 }} />
        </div>
        <select name="campaign" defaultValue={sp.campaign ?? ""} className="glass-select" style={{ maxWidth: 220 }} aria-label="Campaign"><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="sender" defaultValue={sp.sender ?? ""} className="glass-select" style={{ maxWidth: 200 }} aria-label="Sender profile"><option value="">All senders</option>{senders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select name="stage" defaultValue={stage ?? ""} className="glass-select" style={{ maxWidth: 210 }} aria-label="Stage"><option value="">All stages</option>{JOURNEY_STAGES.map((k) => <option key={k} value={k}>{STAGE_INFO[k].n}. {STAGE_INFO[k].label}</option>)}</select>
        <select name="call" defaultValue={sp.call ?? ""} className="glass-select" style={{ maxWidth: 170 }} aria-label="Eligible to call"><option value="">Call: any</option><option value="yes">Eligible to call</option><option value="no">Not eligible</option></select>
        <button className="btn btn-primary">Filter</button>
        {(sp.q || scoped || stage || sp.call) && <Link href="/people" className="btn btn-ghost">Clear</Link>}
      </form>

      <Card pad={false}>
        {people.length === 0 ? (
          <div className="card-pad"><Empty icon={<Users size={20} />} title="No people match" sub="Import a CSV of companies and people, or clear the filters." action={<Link href="/import" className="btn btn-primary btn-sm">Import Companies &amp; People</Link>} /></div>
        ) : (
          <ActionForm action={bulkUpdateAction} resetOnSuccess>
            <input type="hidden" name="campaignId" value={sp.campaign ?? ""} />
            <input type="hidden" name="senderId" value={sp.sender ?? ""} />
            <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <span className="micro">Bulk update</span>
              {bulkReady ? (
                <>
                  <select name="action" className="glass-select" style={{ maxWidth: 240 }} defaultValue="" aria-label="Bulk action">
                    <option value="" disabled>Mark selected as…</option>
                    <option value="connection_sent">Connection Sent</option>
                    <option value="connection_accepted">Connection Accepted</option>
                    <option value="follow_up_sent">Follow-up Sent (+1)</option>
                    <option value="details_shared">Details Shared</option>
                    <optgroup label="Set stage">{JOURNEY_STAGES.map((k) => <option key={k} value={`stage:${k}`}>{STAGE_INFO[k].label}</option>)}</optgroup>
                  </select>
                  <input type="date" name="date" className="glass-input" style={{ maxWidth: 160 }} aria-label="Activity date" defaultValue={now.toISOString().slice(0, 10)} />
                  <SubmitButton className="btn btn-primary btn-sm">Apply to selected</SubmitButton>
                </>
              ) : (
                <span className="muted text-xs">Filter by one campaign and one sender profile to update journeys in bulk.</span>
              )}
            </div>
            <div className="table-wrap">
              <table className="data compact">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>{bulkReady && <SelectAll name="contactIds" />}</th>
                    <th>Name</th><th>Job Title</th><th>Company</th><th>Email</th><th>Phone</th><th>Stage</th><th>Last Engagement</th><th>Next Suggested Action</th><th>Eligible to Call</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((c) => {
                    // The journey shown: the most recently active one in the current filter.
                    const j = c.journeys[0];
                    const state = j ? { stage: j.stage, followUpCount: j.followUpCount, replyCount: j.replyCount, lastEngagementAt: j.lastEngagementAt, lastEngagement: j.lastEngagement } : null;
                    const next = state ? nextAction(state, now, { disqualifyReason: c.account.stage === "DISQUALIFIED" ? c.account.disqualifyReason : null }) : null;
                    const call = eligibleToCall({ phone: c.phone, suppressed: c.state === "suppressed", doNotContact: c.state === "do_not_contact" || c.account.doNotContact, companyDisqualified: c.account.stage === "DISQUALIFIED" }, j?.stage ?? null);
                    const info = j ? STAGE_INFO[j.stage] : null;
                    return (
                      <tr key={c.id}>
                        <td>{bulkReady && <input type="checkbox" name="contactIds" value={c.id} className="h-4 w-4 accent-indigo-500" aria-label={`Select ${c.fullName}`} />}</td>
                        <td className="strong whitespace-nowrap"><Link href={`/people/${c.id}${sp.sender ? `?sender=${sp.sender}${sp.campaign ? `&campaign=${sp.campaign}` : ""}` : ""}`} className="hover:underline">{c.fullName}</Link></td>
                        <td className="max-w-[150px] truncate text-xs" title={c.title ?? ""}>{c.title ?? "—"}</td>
                        <td className="max-w-[140px] truncate text-xs" title={c.account.name}><Link href={`/accounts/${c.account.id}`} className="hover:underline">{c.account.name}</Link></td>
                        <td className="mono max-w-[150px] truncate text-[0.7rem]" title={c.email ?? ""}>{c.email ?? "—"}</td>
                        <td className="mono whitespace-nowrap text-[0.72rem]">{c.phone ?? "—"}</td>
                        <td>
                          {info && j ? <span title={`${j.sender.name} · ${j.campaign.name}${c.journeys.length > 1 ? ` (+${c.journeys.length - 1} other journey${c.journeys.length > 2 ? "s" : ""})` : ""}`}><Badge color={info.color}>{stageLabel(j.stage, j.followUpCount)}</Badge></span> : <span className="muted text-xs">No journey</span>}
                          {j && j.replyCount > 0 && <div className="muted mt-0.5 text-[0.68rem]">{j.replyCount} repl{j.replyCount === 1 ? "y" : "ies"}</div>}
                        </td>
                        <td className="max-w-[170px] text-xs">{j?.lastEngagement ? <><div className="truncate" title={j.lastEngagement}>{j.lastEngagement}</div><div className="muted">{ago(j.lastEngagementAt)}</div></> : <span className="muted">—</span>}</td>
                        <td className="max-w-[170px] text-xs">{next ? next.text : "—"}</td>
                        <td>{call.ok ? <Badge color="#059669">Yes</Badge> : <span title={call.reason}><Badge color="#94A3B8">No</Badge></span>}</td>
                        <td>
                          <div className="flex items-center gap-0.5">
                            <Link href={`/people/${c.id}`} className="btn btn-ghost btn-sm" title="View"><Eye size={14} /></Link>
                            <Link href={`/people/${c.id}?edit=1`} className="btn btn-ghost btn-sm" title="Edit"><Pencil size={14} /></Link>
                            {c.phone && call.ok ? <a href={`tel:${c.phone}`} className="btn btn-ghost btn-sm" title={`Call ${c.phone}`}><Phone size={14} /></a> : <span className="btn btn-ghost btn-sm opacity-30" title={call.reason}><Phone size={14} /></span>}
                            <ActionButton action={deletePersonAction.bind(null, c.id)} className="btn btn-ghost btn-sm" confirm={`Delete ${c.fullName}? Their journeys and history are removed.`} title="Delete"><Trash2 size={14} /></ActionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ActionForm>
        )}
      </Card>

      {total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="muted">Page {page} of {Math.ceil(total / PAGE)}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn btn-secondary btn-sm" href={qs({ page: String(page - 1) })}>Previous</Link>}
            {page * PAGE < total && <Link className="btn btn-secondary btn-sm" href={qs({ page: String(page + 1) })}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
