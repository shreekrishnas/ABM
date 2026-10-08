import Link from "next/link";
import { CheckCircle2, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { nextAction } from "@/lib/journey/engine";
import { STAGE_INFO } from "@/lib/journey/stages";
import { ActionButton } from "@/components/client";
import { Avatar } from "@/components/ui";
import { FamilyChip, IntentPill, QueueRow, SectionLabel, StatStrip, type IntentLevel } from "@/components/v2";
import { runAllAction } from "./actions";

export const metadata = { title: "Today" };

type Reading = { score: number; level: IntentLevel; whyNow: string | null; families: string[] };

const REPLY_ACTION: Record<string, string> = { details_requested: "Send the details", interested: "Book the call", replied_neutral: "Reply with context", referred: "Reach the referral" };

/** Today: only what needs a person, each with one action. Everything else runs in the backend. */
export default async function Today() {
  const now = new Date();
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const [replies, approvals, approvalsCount, hotRaw, followCandidates, decisions, sentWeek, repliesWeek, liveConversations] = await Promise.all([
    db.journey.findMany({ where: { stage: { in: ["details_requested", "interested", "replied_neutral", "referred"] }, contact: { mergedIntoId: null } }, orderBy: { lastEngagementAt: "desc" }, take: 6, include: { contact: { include: { account: { select: { name: true } } } }, sender: { select: { name: true } }, events: { where: { type: "reply" }, orderBy: { occurredAt: "desc" }, take: 1 } } }),
    db.draft.findMany({ where: { status: "pending_review" }, orderBy: { createdAt: "asc" }, take: 5, include: { contact: { include: { account: { select: { name: true, tier: true } } } } } }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.account.findMany({ where: { mergedIntoId: null, stage: { notIn: ["CUSTOMER", "DISQUALIFIED"] }, intentReading: { path: ["level"], equals: "hot" } }, select: { id: true, name: true, tier: true, intentReading: true, _count: { select: { contacts: true } } }, take: 30 }),
    db.journey.findMany({ where: { stage: { in: ["connection_accepted", "follow_up_sent", "details_shared", "connection_sent"] }, contact: { mergedIntoId: null } }, orderBy: { lastEngagementAt: "asc" }, take: 60, include: { contact: { include: { account: { select: { name: true, stage: true, disqualifyReason: true } } } }, sender: { select: { name: true } } } }),
    db.reviewItem.findMany({ where: { status: "open", type: { notIn: ["draft_approval"] } }, orderBy: { createdAt: "asc" }, take: 5, include: { account: { select: { name: true } }, contact: { select: { fullName: true } } } }),
    db.message.count({ where: { sentAt: { gte: week } } }),
    db.journeyEvent.count({ where: { type: "reply", occurredAt: { gte: week } } }),
    db.journey.count({ where: { stage: { in: ["replied_neutral", "details_requested", "details_shared", "interested", "call_scheduled", "demo_scheduled"] } } }),
  ]);
  const hot = hotRaw.map((a) => ({ ...a, r: a.intentReading as unknown as Reading })).sort((x, y) => y.r.score - x.r.score).slice(0, 6);
  const followUps = followCandidates
    .map((j) => ({ j, n: nextAction({ stage: j.stage, followUpCount: j.followUpCount, replyCount: j.replyCount, lastEngagementAt: j.lastEngagementAt, lastEngagement: j.lastEngagement }, now, { disqualifyReason: j.contact.account.stage === "DISQUALIFIED" ? j.contact.account.disqualifyReason : null }) }))
    .filter((x) => x.n.dueAt && x.n.dueAt <= now && !x.n.text.startsWith("No outreach"))
    .slice(0, 6);
  const total = replies.length + approvalsCount + followUps.length + decisions.length;
  const hour = now.getHours();

  return (
    <div className="page-enter mx-auto max-w-[1180px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
          <h1 className="page-title mt-1">{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}. {total ? `${total} thing${total > 1 ? "s" : ""} need you today.` : "Nothing needs you right now."}</h1>
          <p className="secondary mt-1.5 text-sm">Research, scoring and drafting run on their own. This page shows only what a person has to do.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/import" className="btn btn-secondary"><Upload size={15} /> Import</Link>
          <ActionButton action={runAllAction} className="btn btn-brand">Process new companies</ActionButton>
        </div>
      </div>

      <StatStrip items={[
        { label: "Hot companies", value: hotRaw.length, meta: "signals converging" },
        { label: "Live conversations", value: liveConversations, meta: "replied or further on LinkedIn" },
        { label: "Emails to approve", value: approvalsCount, meta: approvalsCount ? "oldest first below" : "all clear" },
        { label: "Replies this week", value: repliesWeek, meta: `${sentWeek} emails sent` },
      ]} />

      <div className="grid gap-x-6 lg:grid-cols-2">
        <div>
          <SectionLabel count={replies.length}>Reply to people who answered</SectionLabel>
          {replies.length === 0 ? <Clear text="No open replies." /> : (
            <div className="queue stagger">
              {replies.map((j) => (
                <QueueRow key={j.id} href={`/people/${j.contactId}`} rail={STAGE_INFO[j.stage].color}
                  lead={<Avatar name={j.contact.fullName} id={j.contactId} size={34} round />}
                  title={`${j.contact.fullName} · ${j.contact.account.name}`}
                  sub={j.events[0]?.detail ? `“${j.events[0].detail.split(" · ")[0].slice(0, 140)}”` : `${STAGE_INFO[j.stage].label} on LinkedIn`}
                  meta={<><span className="chip" style={{ ["--c" as string]: STAGE_INFO[j.stage].color }}>{STAGE_INFO[j.stage].label}</span><span className="chip">{j.sender.name}</span></>}
                  action={REPLY_ACTION[j.stage] ?? "Open"} />
              ))}
            </div>
          )}

          <SectionLabel count={followUps.length}>Follow-ups due on LinkedIn</SectionLabel>
          {followUps.length === 0 ? <Clear text="No follow-ups due." /> : (
            <div className="queue">
              {followUps.map(({ j, n }) => (
                <QueueRow key={j.id} href={`/people/${j.contactId}`} rail="var(--fam-conversation)" title={`${j.contact.fullName} · ${j.contact.account.name}`} sub={`${n.text} · ${j.sender.name}`} action="Do it" />
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionLabel count={hotRaw.length} action={<Link href="/accounts?sort=intent" className="text-xs font-semibold" style={{ color: "var(--accent-indigo)" }}>All companies</Link>}>Hot companies — act while it is true</SectionLabel>
          {hot.length === 0 ? <Clear text="No company is hot yet. Hot needs at least two independent signals agreeing." /> : (
            <div className="queue stagger">
              {hot.map((a) => (
                <QueueRow key={a.id} href={`/accounts/${a.id}`} rail="var(--intent-hot)"
                  lead={<Avatar name={a.name} id={a.id} size={34} />}
                  title={<span className="inline-flex items-center gap-2">{a.name} <IntentPill level={a.r.level} score={a.r.score} /></span>}
                  sub={a.r.whyNow ?? undefined}
                  meta={a.r.families.slice(0, 4).map((f) => <FamilyChip key={f} family={f} />)}
                  action="Open" />
              ))}
            </div>
          )}

          <SectionLabel count={approvalsCount} action={approvalsCount > approvals.length ? <Link href="/review" className="text-xs font-semibold" style={{ color: "var(--accent-indigo)" }}>All {approvalsCount}</Link> : undefined}>Emails waiting for your approval</SectionLabel>
          {approvals.length === 0 ? <Clear text="Nothing to approve." /> : (
            <div className="queue">
              {approvals.map((d) => (
                <QueueRow key={d.id} href="/review" rail="var(--accent-indigo)" title={`${d.contact.fullName} · ${d.contact.account.name}`} sub={`“${d.subject}”${d.painPoint ? ` — ${d.painPoint}` : ""}`} meta={d.rewrites ? <span className="chip">Rewritten {d.rewrites}× by the brain</span> : undefined} action="Review" />
              ))}
            </div>
          )}

          <SectionLabel count={decisions.length}>Needs a decision</SectionLabel>
          {decisions.length === 0 ? <Clear text="No open questions." /> : (
            <div className="queue">
              {decisions.map((r) => (
                <QueueRow key={r.id} href="/review" rail="var(--wait)" title={[r.contact?.fullName, r.account?.name].filter(Boolean).join(" · ") || r.type.replace(/_/g, " ")} sub={r.reason} action="Decide" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Clear({ text }: { text: string }) {
  return <div className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm secondary read-surface" style={{ border: "1px dashed var(--border-default)" }}><CheckCircle2 size={16} style={{ color: "var(--ok)" }} /> {text}</div>;
}
