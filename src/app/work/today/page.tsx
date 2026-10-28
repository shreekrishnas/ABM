import Link from "next/link";
import { ArrowRight, Circle, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { nextAction } from "@/lib/journey/engine";
import { STAGE_INFO } from "@/lib/journey/stages";
import { ActionButton } from "@/components/client";
import { Avatar } from "@/components/ui";
import { FamilyChip, type IntentLevel } from "@/components/v2";
import { Badge, DecisionCard, EmptyState, PageHeader, Stat, StatRow } from "@/components/kit";
import { reviewLabel } from "@/lib/review-labels";
import { runAllAction, setTaskStatusAction } from "../../actions";
import { TopOpportunities } from "./top-opportunities";

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
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" }).format(now));

  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const me = await getMe();
  const firstName = me?.name.split(/\s+/)[0];
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const myTasks = await db.task.findMany({
    where: { status: { in: ["todo", "in_progress"] }, dueAt: { lte: endOfDay }, ...(me ? { OR: [{ assigneeId: me.id }, { assigneeId: null }] } : {}) },
    orderBy: { dueAt: "asc" }, take: 8, include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, fullName: true } } },
  });

  const decisionsOpen = await db.reviewItem.count({ where: { status: "open", type: { notIn: ["draft_approval"] } } });

  return (
    <div className="page-enter td2">
      <PageHeader
        title={`${greet}${firstName ? `, ${firstName}` : ""}`}
        description={total ? <><b>{total} thing{total > 1 ? "s" : ""}</b> need a person today. Everything else runs on its own.</> : "Nothing needs you right now. Research, scoring and drafting are running on their own."}
        meta={now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        actions={<>
          <ActionButton action={runAllAction} className="btn btn-primary">Process new companies</ActionButton>
          <Link href="/import" className="btn btn-secondary"><Upload size={15} /> Import</Link>
        </>}
      />

      <StatRow>
        <Stat id="replies_open" value={replies.length} tone={replies.length ? "success" : "default"} sub={`${repliesWeek} this week · ${sentWeek} emails sent`} />
        <Stat id="emails_to_approve" value={approvalsCount} tone={approvalsCount ? "warning" : "default"} sub={approvalsCount ? "Oldest first below" : "All clear"} />
        <Stat id="followups_due" value={followUps.length} sub="On LinkedIn" />
        <Stat id="decisions_today" value={decisionsOpen} tone={decisionsOpen ? "warning" : "default"} sub={decisionsOpen > decisions.length ? `${decisions.length} oldest shown below` : "All shown below"} />
        <Stat id="hot_companies" value={hotRaw.length} tone={hotRaw.length ? "danger" : "default"} sub="Signals converging" />
        <Stat id="live_conversations" value={liveConversations} sub="Replied or further" />
      </StatRow>

      <TopOpportunities now={now} />

      <div className="td2-grid">
        <div className="td2-col">
          <Section id="replies" title="Reply to people who answered" count={replies.length}>
            {replies.length === 0 ? <EmptyState title="No open replies" /> : replies.map((j) => (
              <Row key={j.id} href={`/people/${j.contactId}`} lead={<Avatar name={j.contact.fullName} id={j.contactId} size={32} round />}
                title={`${j.contact.fullName} · ${j.contact.account.name}`}
                sub={j.events[0]?.detail ? `“${j.events[0].detail.split(" · ")[0].slice(0, 140)}”` : `${STAGE_INFO[j.stage].label} on LinkedIn`}
                tags={<><Badge tone="success">{STAGE_INFO[j.stage].label}</Badge><Badge>{j.sender.name}</Badge></>}
                action={REPLY_ACTION[j.stage] ?? "Open"} />
            ))}
          </Section>

          <Section id="approvals" title="Emails to approve" count={approvalsCount} link={approvalsCount > approvals.length ? { href: "/review", label: `All ${approvalsCount}` } : undefined}>
            {approvals.length === 0 ? <EmptyState title="Nothing to approve" /> : approvals.map((d) => (
              <Row key={d.id} href="/review" title={`${d.contact.fullName} · ${d.contact.account.name}`} sub={`“${d.subject}”${d.painPoint ? ` — ${d.painPoint}` : ""}`}
                tags={d.rewrites ? <Badge tone="accent">Rewritten {d.rewrites}× by the brain</Badge> : undefined} action="Review" />
            ))}
          </Section>

          <Section id="decisions" title="Needs a decision" count={decisionsOpen} note={decisionsOpen > decisions.length ? `${decisions.length} oldest shown · ${decisionsOpen} open in Approvals` : undefined} link={{ href: "/review", label: "Open Approvals" }}>
            {decisions.length === 0 ? <EmptyState title="No open questions" /> : decisions.map((r) => (
              <DecisionCard key={r.id} variant="queue" type={r.type} href={`/review?type=${r.type}`} title={[r.contact?.fullName, r.account?.name].filter(Boolean).join(" · ") || reviewLabel(r.type)} context={r.reason} />
            ))}
          </Section>

          <Section id="followups" title="Follow-ups due on LinkedIn" count={followUps.length}>
            {followUps.length === 0 ? <EmptyState title="No follow-ups due" /> : followUps.map(({ j, n }) => (
              <Row key={j.id} href={`/people/${j.contactId}`} title={`${j.contact.fullName} · ${j.contact.account.name}`} sub={`${n.text} · ${j.sender.name}`} action="Do it" />
            ))}
          </Section>
        </div>

        <div className="td2-col">
          <Section id="tasks" title="Your tasks due today" count={myTasks.length} link={{ href: "/crm/tasks", label: "All tasks" }}>
            {myTasks.length === 0 ? <EmptyState title="No tasks due" text="Add one from any company, person or signal." /> : (
              <ul className="td2-tasks">
                {myTasks.map((t) => (
                  <li key={t.id}>
                    <ActionButton action={setTaskStatusAction.bind(null, t.id, "done")} className="btn btn-ghost btn-icon btn-sm" title="Mark done"><Circle size={16} /></ActionButton>
                    <div className="min-w-0 flex-1">
                      <div className="td2-t">{t.title}</div>
                      <div className="td2-s">{[t.contact?.fullName, t.account?.name].filter(Boolean).join(" · ") || "General"}{t.dueAt && t.dueAt < now ? " · overdue" : ""}</div>
                    </div>
                    {t.account && <Link href={`/accounts/${t.account.id}`} className="td2-link">Open</Link>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="hot" title="Hot companies to act on now" count={hotRaw.length} link={{ href: "/accounts?sort=intent", label: "All companies" }}>
            {hot.length === 0 ? <EmptyState title="No company is hot yet" text="Hot needs at least two independent signals agreeing." /> : hot.map((a) => (
              <Row key={a.id} href={`/accounts/${a.id}`} lead={<Avatar name={a.name} id={a.id} size={32} />}
                title={<span className="inline-flex items-center gap-2">{a.name} <Badge tone="danger">Hot · {Math.round(a.r.score)}</Badge></span>}
                sub={a.r.whyNow ?? undefined} tags={a.r.families.slice(0, 4).map((f) => <FamilyChip key={f} family={f} />)} action="Open" />
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

/** A titled list on Today; the count says how many, the note says what's shown when it's capped. */
function Section({ id, title, count, note, link, children }: { id: string; title: string; count: number; note?: string; link?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section id={id} className="td2-sec">
      <header>
        <h2>{title}</h2>
        <Badge tone={count ? "accent" : "neutral"}>{count}</Badge>
        {link && <Link href={link.href} className="td2-link">{link.label}</Link>}
      </header>
      {note && <p className="td2-note">{note}</p>}
      <div className="td2-list">{children}</div>
    </section>
  );
}

/** One item that needs a person, with the one action to take. */
function Row({ href, lead, title, sub, tags, action }: { href: string; lead?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; tags?: React.ReactNode; action: string }) {
  return (
    <Link href={href} className="td2-row">
      {lead}
      <span className="min-w-0 flex-1">
        <span className="td2-t">{title}</span>
        {sub && <span className="td2-s">{sub}</span>}
        {tags && <span className="td2-tags">{tags}</span>}
      </span>
      <span className="td2-act">{action}<ArrowRight size={14} /></span>
    </Link>
  );
}
