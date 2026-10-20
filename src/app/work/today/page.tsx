import Link from "next/link";
import { CheckCircle2, Circle, ClipboardCheck, Flame, HelpCircle, ListTodo, MessageSquareReply, Repeat, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { nextAction } from "@/lib/journey/engine";
import { STAGE_INFO } from "@/lib/journey/stages";
import { ActionButton } from "@/components/client";
import { Avatar } from "@/components/ui";
import { FamilyChip, IntentPill, QueueRow, StatStrip, type IntentLevel } from "@/components/v2";
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

  const lanes = [
    { id: "replies", label: "Replies", n: replies.length, icon: MessageSquareReply, tone: "emerald" },
    { id: "approvals", label: "To approve", n: approvalsCount, icon: ClipboardCheck, tone: "amber" },
    { id: "followups", label: "Follow-ups", n: followUps.length, icon: Repeat, tone: "sky" },
    { id: "decisions", label: "Decisions", n: decisions.length, icon: HelpCircle, tone: "violet" },
  ];
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const me = await getMe();
  const firstName = me?.name.split(/\s+/)[0];
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const myTasks = await db.task.findMany({
    where: { status: { in: ["todo", "in_progress"] }, dueAt: { lte: endOfDay }, ...(me ? { OR: [{ assigneeId: me.id }, { assigneeId: null }] } : {}) },
    orderBy: { dueAt: "asc" }, take: 8, include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, fullName: true } } },
  });

  return (
    <div className="page-enter td">
      <section className="td-hero">
        <div className="td-hero-main">
          <div className="td-date">{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
          <h1 className="td-title">{greet}{firstName ? `, ${firstName}` : ""}.</h1>
          <p className="td-lede">{total ? <><b>{total} thing{total > 1 ? "s" : ""}</b> need a person today. Everything else runs on its own.</> : "Nothing needs you right now. Research, scoring and drafting are running on their own."}</p>
          <div className="td-actions">
            <ActionButton action={runAllAction} className="td-btn-primary">Process new companies</ActionButton>
            <Link href="/import" className="td-btn-ghost"><Upload size={15} /> Import</Link>
          </div>
        </div>
        <div className="td-lanes">
          {lanes.map((l) => (
            <a key={l.id} href={`#${l.id}`} className={`td-lane t-${l.tone}${l.n ? " has" : ""}`}>
              <span className="td-lane-ic"><l.icon size={17} strokeWidth={2} /></span>
              <span className="td-lane-n tnum">{l.n}</span>
              <span className="td-lane-l">{l.label}</span>
            </a>
          ))}
        </div>
      </section>

      <StatStrip items={[
        { label: "Hot companies", value: hotRaw.length, meta: "signals converging" },
        { label: "Live conversations", value: liveConversations, meta: "replied or further on LinkedIn" },
        { label: "Emails to approve", value: approvalsCount, meta: approvalsCount ? "oldest first below" : "all clear" },
        { label: "Replies this week", value: repliesWeek, meta: `${sentWeek} emails sent` },
      ]} />

      <TopOpportunities now={now} />

      <div className="td-grid">
        <Panel id="replies" icon={MessageSquareReply} tone="emerald" title="Reply to people who answered" count={replies.length}>
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
        </Panel>

        <Panel id="tasks" icon={ListTodo} tone="sky" title="Your tasks due today" count={myTasks.length} action={<Link href="/crm/tasks" className="td-link">All tasks</Link>}>
          {myTasks.length === 0 ? <Clear text="No tasks due. Add one from any company, person or signal." /> : (
            <ul className="td-tasks">
              {myTasks.map((t) => (
                <li key={t.id}>
                  <ActionButton action={setTaskStatusAction.bind(null, t.id, "done")} className="br-icon" title="Mark done"><Circle size={16} /></ActionButton>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t.title}</div>
                    <div className="muted truncate text-xs">{[t.contact?.fullName, t.account?.name].filter(Boolean).join(" · ") || "General"}{t.dueAt && t.dueAt < now ? " · overdue" : ""}</div>
                  </div>
                  {t.account && <Link href={`/accounts/${t.account.id}`} className="td-link">Open</Link>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="hot" icon={Flame} tone="rose" title="Hot companies to act on now" count={hotRaw.length} action={<Link href="/accounts?sort=intent" className="td-link">All companies</Link>}>
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
        </Panel>

        <Panel id="approvals" icon={ClipboardCheck} tone="amber" title="Emails waiting for your approval" count={approvalsCount} action={approvalsCount > approvals.length ? <Link href="/review" className="td-link">All {approvalsCount}</Link> : undefined}>
          {approvals.length === 0 ? <Clear text="Nothing to approve." /> : (
            <div className="queue">
              {approvals.map((d) => (
                <QueueRow key={d.id} href="/review" rail="var(--accent-indigo)" title={`${d.contact.fullName} · ${d.contact.account.name}`} sub={`“${d.subject}”${d.painPoint ? ` — ${d.painPoint}` : ""}`} meta={d.rewrites ? <span className="chip">Rewritten {d.rewrites}× by the brain</span> : undefined} action="Review" />
              ))}
            </div>
          )}
        </Panel>

        <Panel id="followups" icon={Repeat} tone="sky" title="Follow-ups due on LinkedIn" count={followUps.length}>
          {followUps.length === 0 ? <Clear text="No follow-ups due." /> : (
            <div className="queue">
              {followUps.map(({ j, n }) => (
                <QueueRow key={j.id} href={`/people/${j.contactId}`} rail="var(--fam-conversation)" title={`${j.contact.fullName} · ${j.contact.account.name}`} sub={`${n.text} · ${j.sender.name}`} action="Do it" />
              ))}
            </div>
          )}
        </Panel>

        <Panel id="decisions" icon={HelpCircle} tone="violet" title="Needs a decision" count={decisions.length}>
          {decisions.length === 0 ? <Clear text="No open questions." /> : (
            <div className="queue">
              {decisions.map((r) => (
                <QueueRow key={r.id} href="/review" rail="var(--wait)" title={[r.contact?.fullName, r.account?.name].filter(Boolean).join(" · ") || r.type.replace(/_/g, " ")} sub={r.reason} action="Decide" />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ id, icon: Icon, tone, title, count, action, children }: { id: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; tone: string; title: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className={`td-panel t-${tone}`}>
      <header className="td-panel-head">
        <span className="td-panel-ic"><Icon size={17} strokeWidth={2} /></span>
        <h2>{title}</h2>
        <span className={`td-count tnum${count ? " has" : ""}`}>{count}</span>
        {action && <span className="ml-auto">{action}</span>}
      </header>
      <div className="td-panel-body">{children}</div>
    </section>
  );
}

function Clear({ text }: { text: string }) {
  return <div className="td-clear"><CheckCircle2 size={16} /> {text}</div>;
}
