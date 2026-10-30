import Link from "next/link";
import { ArrowRight, Circle, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { nextAction } from "@/lib/journey/engine";
import { STAGE_INFO } from "@/lib/journey/stages";
import { ActionButton } from "@/components/client";
import { Avatar } from "@/components/ui";
import { FamilyChip, type IntentLevel } from "@/components/v2";
import { Badge, DecisionCard, EmptyState } from "@/components/kit";
import { reviewLabel } from "@/lib/review-labels";
import { runAllAction, setTaskStatusAction } from "../../actions";
import { TopOpportunities } from "./top-opportunities";
import { whyNowReasons } from "@/lib/why-now";

export const metadata = { title: "Today" };

type Reading = { score: number; level: IntentLevel; whyNow: string | null; families: string[] };

const REPLY_ACTION: Record<string, string> = { details_requested: "Send the details", interested: "Book the call", replied_neutral: "Reply with context", referred: "Reach the referral" };

/** Today: only what needs a person, each with one action. Everything else runs in the backend. */
export default async function Today({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
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

  const tabs = [
    { key: "decisions", label: "Decisions", n: decisionsOpen },
    { key: "replies", label: "Replies", n: replies.length },
    { key: "approvals", label: "Emails to approve", n: approvalsCount },
    { key: "followups", label: "Follow-ups", n: followUps.length },
    { key: "tasks", label: "Tasks", n: myTasks.length },
    { key: "hot", label: "Hot", n: hotRaw.length },
  ];
  // The queue opens on the first tab with work in it (decisions first), unless one was picked.
  const active = tabs.find((t) => t.key === q)?.key ?? tabs.find((t) => t.n > 0)?.key ?? "decisions";
  const date = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="page-enter td3">
      <header className="td3-head">
        <div className="min-w-0">
          <h1>Today <span className="td3-date">· {date}</span></h1>
          <p>{total ? <><b>{total}</b> need you{firstName ? `, ${firstName}` : ""}. Everything else runs on its own.</> : `${greet}${firstName ? `, ${firstName}` : ""}. Nothing needs you right now.`}</p>
        </div>
        <div className="td3-actions">
          <ActionButton action={runAllAction} className="btn btn-primary">Process new companies</ActionButton>
          <Link href="/import" className="btn btn-secondary"><Upload size={15} /> Import</Link>
        </div>
      </header>

      <ul className="td3-week" aria-label="This week">
        <li><b className="tnum">{sentWeek}</b> emails sent this week</li>
        <li><b className="tnum">{repliesWeek}</b> replies this week</li>
        <li><b className="tnum">{liveConversations}</b> conversations under way</li>
        <li><b className="tnum">{hotRaw.length}</b> hot companies</li>
      </ul>

      <div className="td3-split">
        <section className="td3-queue" aria-label="Your queue">
          <nav className="tabs td3-tabs" aria-label="Queue">
            {tabs.map((t) => (
              <Link key={t.key} href={`/work/today?q=${t.key}`} scroll={false} className={`tab${active === t.key ? " active" : ""}`} aria-current={active === t.key ? "page" : undefined}>
                {t.label}<span className={`td3-n tnum${t.n ? " on" : ""}`}>{t.n}</span>
              </Link>
            ))}
          </nav>
          <div className="td3-panel">
            {active === "decisions" && (decisions.length === 0 ? <EmptyState title="No open decisions" text="Research, identity checks and rejections that need a person land here." /> : <>
              {decisions.map((r) => (
                <DecisionCard key={r.id} variant="queue" type={r.type} href={`/review?type=${r.type}&pick=${r.id}`} title={[r.contact?.fullName, r.account?.name].filter(Boolean).join(" · ") || reviewLabel(r.type)} context={r.reason} />
              ))}
              {decisionsOpen > decisions.length && <Link href="/review" className="td3-more">All {decisionsOpen} decisions <ArrowRight size={14} /></Link>}
            </>)}
            {active === "replies" && (replies.length === 0 ? <EmptyState title="No open replies" /> : replies.map((j) => (
              <Row key={j.id} href={`/people/${j.contactId}`} lead={<Avatar name={j.contact.fullName} id={j.contactId} size={32} round />}
                title={`${j.contact.fullName} · ${j.contact.account.name}`}
                sub={j.events[0]?.detail ? `“${j.events[0].detail.split(" · ")[0].slice(0, 140)}”` : `${STAGE_INFO[j.stage].label} on LinkedIn`}
                tags={<><Badge tone="success">{STAGE_INFO[j.stage].label}</Badge><Badge>{j.sender.name}</Badge></>}
                action={REPLY_ACTION[j.stage] ?? "Open"} />
            )))}
            {active === "approvals" && (approvals.length === 0 ? <EmptyState title="Nothing to approve" /> : <>
              {approvals.map((d) => (
                <Row key={d.id} href="/review" title={`${d.contact.fullName} · ${d.contact.account.name}`} sub={`“${d.subject}”${d.painPoint ? ` — ${d.painPoint}` : ""}`}
                  tags={d.rewrites ? <Badge tone="accent">Rewritten {d.rewrites}× by the brain</Badge> : undefined} action="Review" />
              ))}
              {approvalsCount > approvals.length && <Link href="/review" className="td3-more">All {approvalsCount} emails <ArrowRight size={14} /></Link>}
            </>)}
            {active === "followups" && (followUps.length === 0 ? <EmptyState title="No follow-ups due" /> : followUps.map(({ j, n }) => (
              <Row key={j.id} href={`/people/${j.contactId}`} title={`${j.contact.fullName} · ${j.contact.account.name}`} sub={`${n.text} · ${j.sender.name}`} action="Do it" />
            )))}
            {active === "tasks" && (myTasks.length === 0 ? <EmptyState title="No tasks due" text="Add one from any company, person or signal." /> : (
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
            ))}
            {active === "hot" && (hot.length === 0 ? <EmptyState title="No company is hot yet" text="Hot needs at least two independent signals agreeing." /> : hot.map((a) => (
              <Row key={a.id} href={`/accounts/${a.id}`} lead={<Avatar name={a.name} id={a.id} size={32} />}
                title={<span className="inline-flex items-center gap-2">{a.name} <Badge tone="danger">Hot · {Math.round(a.r.score)}</Badge></span>}
                sub={whyNowReasons(a.r.whyNow).join(" · ") || undefined} tags={a.r.families.slice(0, 4).map((f) => <FamilyChip key={f} family={f} />)} action="Open" />
            )))}
          </div>
        </section>

        <TopOpportunities now={now} compact />
      </div>
    </div>
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
