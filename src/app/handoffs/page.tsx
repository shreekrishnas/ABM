import Link from "next/link";
import { AlertTriangle, Check, Clock, Globe, Handshake, MessageSquareReply, Phone, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { visitSummary } from "@/lib/web/visits";
import { latestBrief } from "@/lib/brain/strategist";
import { ActionForm, SubmitButton } from "@/components/client";
import { Avatar, Badge, Card, Empty, Kpi, PageHeader, StageBadge, ago } from "@/components/ui";
import { decideHandoffAction } from "../actions";
import { AddTaskButton } from "@/components/shell/QuickTask";

export const metadata = { title: "Sales hand-offs" };

type Brief = { whyNow: string; facts: { text: string; factId: string }[]; unknowns: string[]; engaged: { name: string; title: string | null; signals: string[] }[]; anonymousSignals?: number };

const SEND_BACK_REASONS = ["Not ready yet", "Wrong person engaged", "No budget or timing", "Not a fit for us", "Already in talks elsewhere"];

function timer(due: Date | null, now: Date) {
  if (!due) return null;
  const h = Math.round((due.getTime() - now.getTime()) / 3_600_000);
  return h >= 0 ? { late: false, text: `Respond within ${h < 1 ? "the hour" : `${h}h`}` } : { late: true, text: `Overdue by ${-h < 24 ? `${-h}h` : `${Math.round(-h / 24)}d`}` };
}

/** Hand-offs: everything a rep needs to make the first call, and a clear accept or send-back. */
export default async function HandoffsPage() {
  const now = new Date();
  const handoffs = await db.handoff.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 40, include: { account: true, owner: true } });
  const open = handoffs.filter((h) => h.status === "open" && !h.blocked);
  const overdue = open.filter((h) => h.ackDueAt && h.ackDueAt < now);
  const decided = handoffs.filter((h) => h.status !== "open");
  const sentBack = decided.filter((h) => h.status === "sent_back");
  const accepted = decided.filter((h) => h.status === "accepted");

  // The packet: what they read, what they said, and a suggested first call.
  const packets = new Map(await Promise.all(handoffs.slice(0, 20).map(async (h) => {
    const [visits, replies, sent, brief] = await Promise.all([
      visitSummary({ accountId: h.accountId }, now, 30),
      db.reply.findMany({ where: { contact: { accountId: h.accountId } }, orderBy: { receivedAt: "desc" }, take: 2, include: { contact: { select: { fullName: true, title: true } } } }),
      db.message.count({ where: { contact: { accountId: h.accountId }, sentAt: { not: null } } }),
      latestBrief(h.accountId),
    ]);
    return [h.id, { visits, replies, sent, next: brief?.nextBestAction ?? null }] as const;
  })));

  return (
    <div className="page-enter">
      <PageHeader eyebrow="Sales" title="Hand-offs" sub={`When an account is ready (a positive reply, or engagement of ${CONFIG.engagement.stages.MQA}), its owner gets this packet, outreach pauses, and a response is due within ${CONFIG.handoff.ackSlaHours} hours. Accept it, or send it back to nurture with a reason.`} />
      <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Waiting for a decision" value={open.length} accent="#0E6B5C" />
        <Kpi label="Overdue" value={overdue.length} accent={overdue.length ? "#DC2626" : "#10B981"} meta={`${CONFIG.handoff.ackSlaHours}h to respond`} />
        <Kpi label="Accepted" value={accepted.length} accent="#10B981" />
        <Kpi label="Sent back" value={sentBack.length} accent="#F59E0B" meta={sentBack.length ? `Top reason: ${topReason(sentBack.map((h) => h.decisionReason))}` : "None yet"} />
      </div>

      <div className="mt-5 grid gap-4">
        {handoffs.length === 0 ? <Card><Empty icon={<Handshake size={20} />} title="No hand-offs yet" sub="They appear when an account becomes ready for sales or someone replies positively." /></Card> : handoffs.map((h) => {
          const b = h.briefing as unknown as Brief;
          const pk = packets.get(h.id);
          const t = h.status === "open" && !h.blocked ? timer(h.ackDueAt, now) : null;
          const tone = h.status === "accepted" ? "#10B981" : h.status === "sent_back" ? "#F59E0B" : t?.late ? "#EF4444" : "#0E6B5C";
          return (
            <section key={h.id} className="glass-card-static card-pad ho-card" style={{ borderLeft: `4px solid ${tone}` }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={h.account.name} id={h.account.id} size={44} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><Link href={`/accounts/${h.accountId}`} className="text-base font-bold hover:underline" style={{ color: "var(--text-primary)" }}>{h.account.name}</Link><StageBadge stage={h.account.stage} /><Badge color="#2B2A26">{h.trigger.replace(/_/g, " ")}</Badge></div>
                    <div className="muted mt-0.5 text-xs">To {h.owner?.name ?? "the unassigned queue"} · {ago(h.createdAt)}{h.escalatedAt ? " · escalated to a manager" : ""}</div>
                  </div>
                </div>
                {h.blocked ? <Badge color="#DC2626">Held: briefing failed a fact check</Badge>
                  : h.status === "accepted" ? <span className="ho-state ok"><Check size={14} /> Accepted {h.decidedAt ? ago(h.decidedAt) : ""}{h.decidedBy ? ` by ${h.decidedBy.split("@")[0]}` : ""}</span>
                  : h.status === "sent_back" ? <span className="ho-state back"><Undo2 size={14} /> Sent back: {h.decisionReason}</span>
                  : t && <span className={`ho-state${t.late ? " late" : ""}`}>{t.late ? <AlertTriangle size={14} /> : <Clock size={14} />} {t.text}</span>}
              </div>

              <div className="ho-grid">
                <div>
                  <div className="micro mb-1">Why now</div>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{b.whyNow}</p>
                  {b.facts.length > 0 && <><div className="micro mb-1 mt-3">Facts (each from a source)</div><ul className="grid gap-1 text-sm secondary">{b.facts.slice(0, 4).map((f) => <li key={f.factId}>· {f.text}</li>)}</ul></>}
                  {b.unknowns.length > 0 && <p className="muted mt-2 text-xs">Still unknown: {b.unknowns.map((u) => u.replace(/_/g, " ")).join(", ")}</p>}
                </div>
                <div>
                  <div className="micro mb-1">Who engaged</div>
                  {b.engaged.length ? b.engaged.slice(0, 4).map((e) => <div key={e.name} className="text-sm secondary"><b style={{ color: "var(--text-primary)" }}>{e.name}</b>{e.title ? ` · ${e.title}` : ""} <span className="muted text-xs">({e.signals.map((s) => s.replaceAll("_", " ")).join(", ")})</span></div>) : <span className="muted text-sm">No named person yet</span>}
                  {pk && pk.visits.total > 0 && (
                    <>
                      <div className="micro mb-1 mt-3 flex items-center gap-1"><Globe size={12} /> What they read (30 days)</div>
                      <div className="flex flex-wrap gap-1">{pk.visits.topics.slice(0, 5).map((tp) => <span key={tp.key} className="chip">{tp.label} ×{tp.count}</span>)}</div>
                    </>
                  )}
                </div>
                <div>
                  <div className="micro mb-1 flex items-center gap-1"><MessageSquareReply size={12} /> Conversation</div>
                  {pk?.replies.length ? pk.replies.map((r) => <blockquote key={r.id} className="ho-quote">“{r.body.slice(0, 160)}{r.body.length > 160 ? "…" : ""}”<cite>{r.contact.fullName} · {ago(r.receivedAt)}</cite></blockquote>) : <span className="muted text-sm">No replies yet</span>}
                  {pk && <p className="muted mt-1 text-xs">{pk.sent} email{pk.sent === 1 ? "" : "s"} sent to this account</p>}
                  <div className="micro mb-1 mt-3 flex items-center gap-1"><Phone size={12} /> Suggested first call</div>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{pk?.next ?? (b.engaged[0] ? `Call ${b.engaged[0].name}${b.engaged[0].title ? ` (${b.engaged[0].title})` : ""} and open with: ${b.whyNow}` : "Open with the why-now above.")}</p>
                </div>
              </div>

              {h.status === "open" && !h.blocked && (
                <div className="ho-actions">
                  <ActionForm action={decideHandoffAction}>
                    <input type="hidden" name="handoffId" value={h.id} /><input type="hidden" name="decision" value="accepted" />
                    <SubmitButton className="btn btn-success btn-sm"><Check size={14} /> Accept: I'll take it</SubmitButton>
                  </ActionForm>
                  <AddTaskButton target={{ accountId: h.accountId, label: h.account.name, title: `First call: ${b.engaged[0]?.name ?? h.account.name}`, origin: "handoff" }} />
                  <details className="ho-back">
                    <summary className="btn btn-secondary btn-sm"><Undo2 size={14} /> Send back to nurture</summary>
                    <ActionForm action={decideHandoffAction} className="ho-back-form">
                      <input type="hidden" name="handoffId" value={h.id} /><input type="hidden" name="decision" value="sent_back" />
                      <select name="reason" className="glass-input" defaultValue={SEND_BACK_REASONS[0]} aria-label="Reason">{SEND_BACK_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                      <select name="recheckDays" className="glass-input" defaultValue="30" aria-label="Re-check in">{[14, 30, 60, 90].map((d) => <option key={d} value={d}>Re-check in {d} days</option>)}</select>
                      <SubmitButton className="btn btn-primary btn-sm">Send back</SubmitButton>
                    </ActionForm>
                  </details>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function topReason(reasons: (string | null)[]) {
  const c = new Map<string, number>();
  for (const r of reasons) if (r) c.set(r, (c.get(r) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
}
