import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, MessageSquareText, Pencil, Phone, Trash2, UserPlus as Linkedin } from "lucide-react";
import { db } from "@/lib/db";
import { JOURNEY_STAGES, STAGE_INFO, stageLabel } from "@/lib/journey/stages";
import { eligibleToCall, nextAction } from "@/lib/journey/engine";
import { ActionButton, ActionForm, Modal, SubmitButton } from "@/components/client";
import { ReplyAssistant } from "@/components/reply-assistant";
import { Avatar, Badge, Card, Empty, ago, date } from "@/components/ui";
import { deletePersonAction, logActivityAction, setStageAction, updatePersonAction } from "../../actions";

const EVENT_LABEL: Record<string, string> = {
  connection_sent: "Connection request sent", connection_accepted: "Connection accepted", follow_up_sent: "Follow-up sent", reply: "Reply received",
  details_shared: "Details shared", call_scheduled: "Call scheduled", demo_scheduled: "Demo scheduled", call_logged: "Call made", stage_set: "Stage set", note: "Note", imported: "Imported",
};

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <span className="secondary">{k}</span>
      <span className="text-right" style={{ color: "var(--text-primary)" }}>{v || <span className="muted">—</span>}</span>
    </div>
  );
}

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ journey?: string; sender?: string; campaign?: string; edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.contact.findUnique({
    where: { id },
    include: {
      account: true,
      journeys: { include: { sender: true, campaign: true, events: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 200 } }, orderBy: { updatedAt: "desc" } },
    },
  });
  if (!c) notFound();
  const [campaigns, senders] = await Promise.all([
    db.campaign.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    db.senderProfile.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const j =
    c.journeys.find((x) => x.id === sp.journey) ??
    c.journeys.find((x) => (!sp.sender || x.senderId === sp.sender) && (!sp.campaign || x.campaignId === sp.campaign)) ??
    c.journeys[0];
  const now = new Date();
  const state = j ? { stage: j.stage, followUpCount: j.followUpCount, replyCount: j.replyCount, lastEngagementAt: j.lastEngagementAt, lastEngagement: j.lastEngagement } : null;
  const next = state ? nextAction(state, now) : null;
  const call = eligibleToCall({ phone: c.phone, suppressed: c.state === "suppressed", doNotContact: c.state === "do_not_contact" || c.account.doNotContact }, j?.stage ?? null);
  const hidden = j ? (
    <>
      <input type="hidden" name="contactId" value={c.id} />
      <input type="hidden" name="campaignId" value={j.campaignId} />
      <input type="hidden" name="senderId" value={j.senderId} />
    </>
  ) : null;

  const editForm = (
    <ActionForm action={updatePersonAction} className="grid gap-3" resetOnSuccess={false}>
      <input type="hidden" name="id" value={c.id} />
      <div className="grid grid-cols-2 gap-3">
        <div><label className="field-label" htmlFor="pf">First name</label><input id="pf" name="firstName" defaultValue={c.firstName ?? ""} required className="glass-input" /></div>
        <div><label className="field-label" htmlFor="pl">Last name</label><input id="pl" name="lastName" defaultValue={c.lastName ?? ""} className="glass-input" /></div>
        <div><label className="field-label" htmlFor="pt">Job title</label><input id="pt" name="title" defaultValue={c.title ?? ""} className="glass-input" /></div>
        <div><label className="field-label" htmlFor="pd">Department</label><input id="pd" name="department" defaultValue={c.department ?? ""} className="glass-input" /></div>
        <div><label className="field-label" htmlFor="pe">Email</label><input id="pe" name="email" type="email" defaultValue={c.email ?? ""} className="glass-input" /></div>
        <div><label className="field-label" htmlFor="pp">Phone</label><input id="pp" name="phone" defaultValue={c.phone ?? ""} className="glass-input" placeholder="+91 98765 43210" /></div>
        <div className="col-span-2"><label className="field-label" htmlFor="pli">LinkedIn URL</label><input id="pli" name="linkedinUrl" defaultValue={c.linkedinUrl ?? ""} className="glass-input" /></div>
        <div><label className="field-label" htmlFor="ploc">Location</label><input id="ploc" name="location" defaultValue={c.location ?? ""} className="glass-input" /></div>
      </div>
      <div><label className="field-label" htmlFor="pn">Notes</label><textarea id="pn" name="personNotes" defaultValue={c.personNotes ?? ""} className="glass-textarea" rows={3} /></div>
      <p className="muted text-xs">Changing email, phone, title or LinkedIn URL marks them for re-verification before any outreach.</p>
      <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Save</SubmitButton></div>
    </ActionForm>
  );

  return (
    <div className="page-enter">
      <Link href="/people" className="btn btn-ghost btn-sm mb-3 -ml-2"><ArrowLeft size={14} /> People</Link>

      <div className="glass-card-static card-pad mb-5" style={{ background: "linear-gradient(155deg, rgba(99,102,241,0.08), var(--surface-card) 55%)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={c.fullName} id={c.id} size={56} round />
            <div className="min-w-0">
              <h1 className="page-title truncate">{c.fullName}</h1>
              <div className="secondary text-sm">{c.title ?? "Title unknown"} · <Link href={`/accounts/${c.account.id}`} className="hover:underline">{c.account.name}</Link></div>
              <div className="mono muted mt-1 flex flex-wrap gap-x-3 text-xs">
                {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail size={11} />{c.email}</a>}
                {c.phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{c.phone}</span>}
                {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><Linkedin size={11} />LinkedIn<ExternalLink size={10} /></a>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.phone && call.ok && <a href={`tel:${c.phone}`} className="btn btn-success"><Phone size={15} /> Call</a>}
            <Modal trigger={<><Pencil size={15} /> Edit</>} title={`Edit ${c.fullName}`} eyebrow="People" triggerClass="btn btn-secondary">{editForm}</Modal>
            <ActionButton action={deletePersonAction.bind(null, c.id)} className="btn btn-secondary" confirm={`Delete ${c.fullName}? Their journeys and history are removed.`}><Trash2 size={15} /> Delete</ActionButton>
          </div>
        </div>
      </div>

      {sp.edit === "1" && <Card title="Edit person" className="mb-5">{editForm}</Card>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="grid content-start gap-5 xl:col-span-2">
          <Card
            title="Journey"
            sub="Each sender profile keeps its own history — switching never mixes them"
            action={
              <Modal trigger="Start a journey" title="Start a journey" eyebrow={c.fullName} triggerClass="btn btn-secondary btn-sm">
                <ActionForm action={setStageAction} className="grid gap-3">
                  <input type="hidden" name="contactId" value={c.id} />
                  <div><label className="field-label" htmlFor="nj-c">ABM Campaign or Segment</label><select id="nj-c" name="campaignId" className="glass-select" required defaultValue=""><option value="" disabled>Choose…</option>{campaigns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
                  <div><label className="field-label" htmlFor="nj-s">Sender profile</label><select id="nj-s" name="senderId" className="glass-select" required defaultValue=""><option value="" disabled>Choose…</option>{senders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
                  <input type="hidden" name="stage" value="not_contacted" />
                  <p className="muted text-xs">Create campaigns and sender profiles in Settings or during an import.</p>
                  <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Start at Not Contacted</SubmitButton></div>
                </ActionForm>
              </Modal>
            }
          >
            {c.journeys.length === 0 || !j ? (
              <Empty title="No journey yet" sub="Import this person with a campaign and sender profile, or start a journey here." />
            ) : (
              <div className="grid gap-4">
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sender profile">
                  {c.journeys.map((x) => (
                    <Link key={x.id} role="tab" aria-selected={x.id === j.id} href={`/people/${c.id}?journey=${x.id}`} className="badge" style={{ background: x.id === j.id ? "rgba(99,102,241,0.14)" : "var(--surface-card-header)", color: x.id === j.id ? "#4338CA" : "var(--text-secondary)", border: `1px solid ${x.id === j.id ? "#6366F1" : "transparent"}` }}>
                      {x.sender.name} · {x.campaign.name} · {stageLabel(x.stage, x.followUpCount)}
                    </Link>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}><div className="micro">Stage</div><div className="mt-1"><Badge color={STAGE_INFO[j.stage].color}>{stageLabel(j.stage, j.followUpCount)}</Badge></div></div>
                  <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}><div className="micro">Follow-ups</div><div className="display-num mt-1 text-xl tnum">{j.followUpCount}</div></div>
                  <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}><div className="micro">Replies</div><div className="display-num mt-1 text-xl tnum">{j.replyCount}</div></div>
                  <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}><div className="micro">Eligible to call</div><div className="mt-1 text-sm font-semibold" style={{ color: call.ok ? "#059669" : "var(--text-secondary)" }} title={call.reason}>{call.ok ? "Yes" : "No"}</div><div className="muted text-[0.68rem]">{call.reason}</div></div>
                </div>
                <div className="grid gap-1 text-sm">
                  <div><span className="secondary">Last engagement:</span> <b style={{ color: "var(--text-primary)" }}>{j.lastEngagement ?? "—"}</b> {j.lastEngagementAt && <span className="muted">· {ago(j.lastEngagementAt)}</span>}</div>
                  <div><span className="secondary">Next suggested action:</span> <b style={{ color: "var(--text-primary)" }}>{next?.text}</b></div>
                  <div className="muted text-xs">Campaign: {j.campaign.name} · Sender: {j.sender.name}</div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl p-3" style={{ border: "1px solid var(--border-subtle)" }}>
                    <div className="micro mb-2">Log activity</div>
                    <ActionForm action={logActivityAction} className="grid gap-2">
                      {hidden}
                      <select name="type" className="glass-select" defaultValue="" required aria-label="Activity">
                        <option value="" disabled>Choose activity…</option>
                        <option value="connection_sent">Connection request sent</option>
                        <option value="connection_accepted">Connection accepted</option>
                        <option value="follow_up_sent">Follow-up sent</option>
                        <option value="details_shared">Details shared</option>
                        <option value="call_scheduled">Call scheduled</option>
                        <option value="demo_scheduled">Demo scheduled</option>
                        <option value="call_logged">Call made</option>
                        <option value="note">Note</option>
                      </select>
                      <input type="date" name="date" className="glass-input" defaultValue={now.toISOString().slice(0, 10)} aria-label="Date" />
                      <input name="detail" className="glass-input" placeholder="Detail (optional)" />
                      <div className="flex justify-end"><SubmitButton className="btn btn-primary btn-sm">Save activity</SubmitButton></div>
                    </ActionForm>
                  </div>
                  <div className="rounded-xl p-3" style={{ border: "1px solid var(--border-subtle)" }}>
                    <div className="micro mb-2">Set stage</div>
                    <ActionForm action={setStageAction} className="grid gap-2">
                      {hidden}
                      <select name="stage" className="glass-select" defaultValue={j.stage} aria-label="Stage">
                        {JOURNEY_STAGES.map((k) => <option key={k} value={k}>{STAGE_INFO[k].n}. {STAGE_INFO[k].label}</option>)}
                      </select>
                      <input name="reason" className="glass-input" placeholder="Reason (e.g. loss reason, referral)" />
                      <div className="flex justify-end"><SubmitButton className="btn btn-secondary btn-sm">Set stage</SubmitButton></div>
                    </ActionForm>
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ border: "1px solid var(--border-subtle)" }}>
                  <div className="micro mb-2 flex items-center gap-1.5"><MessageSquareText size={13} /> Paste a reply</div>
                  <ReplyAssistant contactId={c.id} campaignId={j.campaignId} senderId={j.senderId} />
                </div>
              </div>
            )}
          </Card>

          {j && (
            <Card title="Journey timeline" sub={`${j.sender.name} · ${j.campaign.name} — every follow-up and reply stays in history`}>
              {j.events.length === 0 ? <Empty title="No activity yet" /> : (
                <ul className="timeline">
                  {j.events.map((e) => (
                    <li key={e.id} className="tl-item" style={{ ["--tl" as string]: e.toStage ? STAGE_INFO[e.toStage].color : "#94A3B8" }}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm">
                          <b style={{ color: "var(--text-primary)" }}>{EVENT_LABEL[e.type] ?? e.type}</b>
                          {e.fromStage && e.toStage && e.fromStage !== e.toStage && <span className="secondary"> · {STAGE_INFO[e.fromStage].label} → {STAGE_INFO[e.toStage].label}</span>}
                          {e.detail && <div className="secondary mt-0.5 whitespace-pre-wrap text-xs">{e.detail}</div>}
                        </span>
                        <span className="mono muted whitespace-nowrap text-xs">{date(e.occurredAt)} · {e.source}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="grid content-start gap-5">
          <Card title="Identity & contact">
            <Field k="First name" v={c.firstName} />
            <Field k="Last name" v={c.lastName} />
            <Field k="Job title" v={c.title} />
            <Field k="Department" v={c.department} />
            <Field k="Seniority" v={c.seniority?.replace("_", " ")} />
            <Field k="Location" v={c.location} />
            <Field k="Company" v={<Link href={`/accounts/${c.account.id}`} className="hover:underline">{c.account.name}</Link>} />
            <Field k="Data source" v={c.source} />
            <Field k="Added" v={date(c.createdAt)} />
          </Card>
          <Card title="Notes">{c.personNotes ? <p className="secondary whitespace-pre-wrap text-sm">{c.personNotes}</p> : <span className="muted text-xs">No notes — add them with Edit.</span>}</Card>
          <Card title="AI pipeline" sub="Email research and verification (separate from LinkedIn journeys)">
            <Field k="Buying role" v={c.buyingRole.replace("_", " ")} />
            <Field k="Readiness" v={c.readiness?.replaceAll("_", " ")} />
            <Field k="State" v={c.state.replace("_", " ")} />
          </Card>
        </div>
      </div>
    </div>
  );
}
