import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { db } from "@/lib/db";
import type { PriorityParts } from "@/lib/brain/priority";
import { visitSummary } from "@/lib/web/visits";
import { STAGE_INFO } from "@/lib/journey/stages";
import { Avatar, TierBadge, ago } from "@/components/ui";
import { FamilyChip, IntentPill, type IntentLevel } from "@/components/v2";
import { PipelineStepper, accountStep } from "./stepper";

type Reading = { score: number; level: IntentLevel; whyNow: string | null; families: string[] };

function Shell({ title, sub, lead, close, open, children }: { title: string; sub?: string; lead?: React.ReactNode; close: string; open: string; children: React.ReactNode }) {
  return (
    <aside className="peek glass-card-static" aria-label={`Preview: ${title}`}>
      <div className="peek-head">
        {lead}
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold" style={{ color: "var(--text-primary)" }}>{title}</div>
          {sub && <div className="muted truncate text-xs">{sub}</div>}
        </div>
        <Link href={close} className="round-control peek-close" aria-label="Close preview (Esc)" title="Close (Esc)" data-peek-close><X size={16} /></Link>
      </div>
      <div className="peek-body">{children}</div>
      <div className="peek-foot">
        <Link href={open} className="btn btn-primary btn-sm w-full justify-center" data-peek-open>Open full page <ArrowRight size={14} /></Link>
        <div className="muted mt-2 text-center text-[0.68rem]">J / K move · Enter opens · Esc closes</div>
      </div>
    </aside>
  );
}

export async function CompanyPeek({ id, close }: { id: string; close: string }) {
  const a = await db.account.findUnique({
    where: { id },
    include: { contacts: { where: { mergedIntoId: null }, take: 6, orderBy: { createdAt: "asc" }, select: { id: true, fullName: true, titleNormalized: true, title: true, email: true } }, _count: { select: { contacts: true } } },
  });
  if (!a) return null;
  const [drafts, handoff, visits] = await Promise.all([
    db.draft.count({ where: { status: "pending_review", contact: { accountId: id } } }),
    db.handoff.findFirst({ where: { accountId: id }, select: { acknowledgedAt: true } }),
    visitSummary({ accountId: id }),
  ]);
  const r = a.intentReading as unknown as Reading | null;
  const pp = a.priorityParts as unknown as PriorityParts | null;
  return (
    <Shell title={a.name} sub={[a.domain, a.industry, a.employees != null ? `${a.employees.toLocaleString()} employees` : null].filter(Boolean).join(" · ")} lead={<Avatar name={a.name} id={a.id} size={38} />} close={close} open={`/accounts/${a.id}`}>
      <PipelineStepper current={accountStep(a, { drafts, handoff: Boolean(handoff) })} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TierBadge tier={a.tier} />
        {r && <IntentPill level={r.level} score={r.score} />}
        {a.priorityScore != null && <span className="chip" title={pp ? `intent ${pp.intent} · fit ${pp.fit} · value ${pp.value} · timing ${pp.timing}` : undefined}>Priority {a.priorityScore}</span>}
      </div>
      {a.disqualifyReason && <p className="mt-3 text-xs" style={{ color: "var(--intent-hot)" }}>{a.disqualifyReason}</p>}
      {r?.whyNow && <p className="secondary mt-3 text-sm"><b style={{ color: "var(--text-primary)" }}>Why now: </b>{r.whyNow}</p>}
      {r?.families?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{r.families.slice(0, 5).map((f) => <FamilyChip key={f} family={f} />)}</div> : null}
      {(drafts > 0 || visits.total > 0) && (
        <div className="mt-3 grid gap-1.5 text-sm">
          {drafts > 0 && <Link href="/review" className="peek-row"><span>{drafts} email{drafts > 1 ? "s" : ""} waiting for approval</span><ArrowRight size={13} /></Link>}
          {visits.total > 0 && <Link href={`/accounts/${a.id}?tab=activity`} className="peek-row"><span>{visits.total} website visit{visits.total > 1 ? "s" : ""}{visits.topics[0] && visits.topics[0].key !== "general" ? ` · ${visits.topics[0].label}` : ""}</span><span className="muted text-xs">{ago(visits.last)}</span></Link>}
        </div>
      )}
      <div className="peek-label">Buying group · {a._count.contacts}</div>
      {a.contacts.length === 0 ? <p className="muted text-xs">No people yet.</p> : (
        <ul className="grid gap-1">
          {a.contacts.map((c) => (
            <li key={c.id}><Link href={`/people/${c.id}`} className="peek-row"><span className="min-w-0 truncate"><b style={{ color: "var(--text-primary)" }}>{c.fullName}</b> <span className="muted">{c.titleNormalized ?? c.title ?? ""}</span></span><ArrowRight size={13} /></Link></li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

export async function PersonPeek({ id, close }: { id: string; close: string }) {
  const c = await db.contact.findUnique({
    where: { id },
    include: { account: { select: { id: true, name: true } }, journeys: { take: 3, orderBy: { updatedAt: "desc" }, include: { sender: { select: { name: true } } } }, messages: { take: 3, orderBy: { id: "desc" }, select: { id: true, sentAt: true, status: true, draft: { select: { subject: true } } } } },
  });
  if (!c) return null;
  const visits = await visitSummary({ contactId: id });
  return (
    <Shell title={c.fullName} sub={[c.titleNormalized ?? c.title, c.account.name].filter(Boolean).join(" · ")} lead={<Avatar name={c.fullName} id={c.id} size={38} round />} close={close} open={`/people/${c.id}`}>
      <div className="grid gap-1 text-sm">
        <Link href={`/accounts/${c.account.id}`} className="peek-row"><span>Company: <b style={{ color: "var(--text-primary)" }}>{c.account.name}</b></span><ArrowRight size={13} /></Link>
        {c.email && <div className="peek-row"><span className="truncate">{c.email}</span></div>}
      </div>
      <div className="peek-label">LinkedIn journey</div>
      {c.journeys.length === 0 ? <p className="muted text-xs">Not in a LinkedIn journey.</p> : c.journeys.map((j) => (
        <div key={j.id} className="peek-row"><span className="chip" style={{ ["--c" as string]: STAGE_INFO[j.stage].color }}>{STAGE_INFO[j.stage].label}</span><span className="muted text-xs">{j.sender.name} · {ago(j.updatedAt)}</span></div>
      ))}
      <div className="peek-label">Emails</div>
      {c.messages.length === 0 ? <p className="muted text-xs">No emails sent yet.</p> : c.messages.map((m) => (
        <div key={m.id} className="peek-row"><span className="min-w-0 truncate">{m.draft?.subject ?? "Email"}</span><span className="muted text-xs">{m.sentAt ? ago(m.sentAt) : m.status}</span></div>
      ))}
      {visits.total > 0 && (<><div className="peek-label">Website</div><p className="secondary text-sm">{visits.total} visit{visits.total > 1 ? "s" : ""} · {visits.topics.map((t) => t.label).slice(0, 3).join(", ")}</p></>)}
    </Shell>
  );
}
