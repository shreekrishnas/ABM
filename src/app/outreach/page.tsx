import Link from "next/link";
import { Mail, MessageSquareReply, Phone, Send, Timer, UserPlus as Linkedin } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { breakerState } from "@/lib/pipeline/stages/engagement";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { Avatar, Badge, Card, Empty, Kpi, Meter, PageHeader, TabLinks, TierBadge, ago } from "@/components/ui";
import { recordReplyAction, sendApprovedAction, tickAction } from "../actions";

export const metadata = { title: "Outreach" };

const CH = { email: Mail, linkedin: Linkedin, call: Phone, task: Timer };

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "sends";
  const today = new Date(new Date().toISOString().slice(0, 10));
  const [sequences, mailboxes, sentToday, draftCounts, messages, replies, breaker, contactsInSeq] = await Promise.all([
    db.sequence.findMany({ include: { steps: { orderBy: { order: "asc" } }, _count: { select: { enrollments: true } } }, orderBy: { name: "asc" } }),
    db.mailbox.findMany({ orderBy: { address: "asc" } }),
    db.message.groupBy({ by: ["mailbox"], where: { sentAt: { gte: today } }, _count: true }),
    db.draft.groupBy({ by: ["status"], _count: true }),
    db.message.findMany({ orderBy: { sentAt: "desc" }, take: 40, include: { contact: { include: { account: true } }, draft: true } }),
    db.reply.findMany({ orderBy: { receivedAt: "desc" }, take: 40, include: { contact: { include: { account: true } } } }),
    breakerState(),
    db.contact.findMany({ where: { messages: { some: { status: "delivered" } } }, select: { id: true, fullName: true, account: { select: { name: true } } }, orderBy: { fullName: "asc" } }),
  ]);
  const D = (s: string) => draftCounts.find((d) => d.status === s)?._count ?? 0;
  const enrollStats = await db.enrollment.groupBy({ by: ["status"], _count: true });
  const E = (s: string) => enrollStats.find((e) => e.status === s)?._count ?? 0;

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Stage 11–12"
        title="Outreach"
        sub="Multi-channel sequences by tier. Email sends automatically after approval; LinkedIn and call steps become tasks for the account owner."
        actions={
          <>
            <ActionButton action={tickAction} className="btn btn-secondary"><Timer size={15} /> Advance sequences</ActionButton>
            <ActionButton action={sendApprovedAction} className="btn btn-brand"><Send size={15} /> Send approved ({D("approved")})</ActionButton>
          </>
        }
      />

      <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-5">
        <Kpi label="Pending approval" value={D("pending_review")} accent="#8B5CF6" meta={<Link href="/review?type=draft_approval" className="hover:underline">Review drafts →</Link>} />
        <Kpi label="Approved, unsent" value={D("approved")} accent="#0EA5E9" meta="Sends on the next run" />
        <Kpi label="Sent" value={D("sent")} accent="#10B981" meta={`${D("rejected")} rejected · ${D("blocked")} blocked`} />
        <Kpi label="Active enrollments" value={E("active")} accent="#4F46E5" meta={`${E("paused")} paused · ${E("completed")} completed`} />
        <Kpi label="Bounce breaker" value={breaker.pass ? "OK" : "TRIPPED"} accent={breaker.pass ? "#10B981" : "#DC2626"} meta={`${breaker.hard} hard / ${breaker.sent} sends (7d) · trips >${CONFIG.sending.bounceBreakerPct}%`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Sequences" sub="Tier picks the sequence" className="xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-3">
            {sequences.map((s) => (
              <div key={s.id} className="rounded-2xl p-4" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{s.name}</span><TierBadge tier={s.tier} /></div>
                <div className="muted mt-0.5 text-xs">{s._count.enrollments} enrolled</div>
                <ol className="mt-3 grid gap-2">
                  {s.steps.map((st) => {
                    const Icon = CH[st.channel];
                    return (
                      <li key={st.id} className="flex items-start gap-2.5 text-xs">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg" style={{ background: "var(--accent-primary-soft)", color: "var(--accent-section)" }}><Icon size={13} /></span>
                        <span><b style={{ color: "var(--text-primary)" }}>Day {st.dayOffset}</b> <span className="secondary">· {st.instruction}</span></span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Mailboxes" sub={`Per-mailbox cap · global cap ${CONFIG.sending.globalDailyCap}/day`}>
          <ul className="grid gap-4">
            {mailboxes.map((m) => {
              const n = sentToday.find((s) => s.mailbox === m.address)?._count ?? 0;
              return (
                <li key={m.id}>
                  <div className="mb-1.5 flex justify-between text-xs"><span className="mono secondary">{m.address}</span><span className="tnum font-semibold" style={{ color: "var(--text-primary)" }}>{n}/{m.dailyCap}</span></div>
                  <Meter value={n} max={m.dailyCap} color={n / m.dailyCap > 0.85 ? "#F59E0B" : undefined} />
                  <div className="muted mt-1 text-[0.7rem]">{m.warmedUp ? "Warmed up" : "Warming up"} · {m.active ? "active" : "paused"}</div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <TabLinks base="/outreach" active={tab} tabs={[{ id: "sends", label: "Sends", count: messages.length }, { id: "replies", label: "Replies", count: replies.length }]} />
        {tab === "sends" && (
          <Card pad={false}>
            {messages.length === 0 ? <Empty icon={<Send size={20} />} title="Nothing sent yet" sub="Approve drafts in the review queue, then send." /> : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Recipient</th><th>Subject</th><th>Step</th><th>Mailbox</th><th>Status</th><th>Sent</th></tr></thead>
                  <tbody>
                    {messages.map((m) => (
                      <tr key={m.id}>
                        <td className="strong"><div className="flex items-center gap-2.5"><Avatar name={m.contact.fullName} id={m.contactId} size={28} round /><div><Link href={`/people/${m.contactId}`} className="hover:underline">{m.contact.fullName}</Link><div className="muted text-xs font-normal"><Link href={`/accounts/${m.contact.accountId}`} className="hover:underline">{m.contact.account.name}</Link></div></div></div></td>
                        <td className="max-w-[280px] truncate">{m.draft.subject}</td>
                        <td className="tnum">{m.draft.stepOrder}</td>
                        <td className="mono">{m.mailbox}</td>
                        <td><Badge color={m.status === "delivered" ? "#059669" : m.status === "bounced" ? "#DC2626" : "#64748B"}>{m.status}{m.bounceType ? ` (${m.bounceType})` : ""}</Badge></td>
                        <td className="muted text-xs">{ago(m.sentAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
        {tab === "replies" && (
          <div className="grid gap-5 xl:grid-cols-3">
            <Card pad={false} className="xl:col-span-2">
              {replies.length === 0 ? <Empty icon={<MessageSquareReply size={20} />} title="No replies yet" /> : (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>From</th><th>Reply</th><th>Class</th><th>Route</th><th>When</th></tr></thead>
                    <tbody>
                      {replies.map((r) => (
                        <tr key={r.id}>
                          <td className="strong whitespace-nowrap"><Link href={`/people/${r.contactId}`} className="hover:underline">{r.contact.fullName}</Link><div className="muted text-xs font-normal">{r.contact.account.name}</div></td>
                          <td className="max-w-[260px]"><span className="line-clamp-2">{r.body}</span></td>
                          <td><Badge color={r.class === "positive" ? "#059669" : r.class === "unsubscribe" ? "#DC2626" : r.class === "needs_human" ? "#7C3AED" : "#B45309"}>{r.class.replace("_", " ")}</Badge></td>
                          <td className="text-xs">{r.route}</td>
                          <td className="muted whitespace-nowrap text-xs">{ago(r.receivedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="Log a reply" sub="Until the inbox integration is connected, paste replies here. They are classified and routed exactly like webhook replies.">
              <ActionForm action={recordReplyAction} className="grid gap-3">
                <div><label className="field-label" htmlFor="rc">Contact</label>
                  <select id="rc" name="contactId" className="glass-select" required defaultValue=""><option value="" disabled>Choose a contacted person</option>{contactsInSeq.map((c) => <option key={c.id} value={c.id}>{c.fullName} · {c.account.name}</option>)}</select>
                </div>
                <div><label className="field-label" htmlFor="rb">Reply text</label><textarea id="rb" name="body" className="glass-textarea" required placeholder="Thanks — can we talk next week?" /></div>
                <div className="flex justify-end"><SubmitButton>Classify &amp; route</SubmitButton></div>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
