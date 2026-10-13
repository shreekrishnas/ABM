import Link from "next/link";
import { AlertTriangle, Check, Handshake } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { ActionButton } from "@/components/client";
import { Avatar, Badge, Card, Empty, Kpi, PageHeader, StageBadge, ago } from "@/components/ui";
import { ackHandoffAction } from "../actions";

export const metadata = { title: "Sales handoffs" };

type Brief = { whyNow: string; facts: { text: string; factId: string }[]; unknowns: string[]; engaged: { name: string; title: string | null; signals: string[] }[]; anonymousSignals?: number };

export default async function HandoffsPage() {
  const handoffs = await db.handoff.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { account: true, owner: true } });
  const open = handoffs.filter((h) => !h.acknowledgedAt && !h.blocked);
  const overdue = open.filter((h) => h.ackDueAt && h.ackDueAt < new Date());
  const closed = await db.opportunity.count({ where: { stage: { in: ["won", "lost"] } } });

  return (
    <div className="page-enter">
      <PageHeader eyebrow="Stage 13" title="Sales handoffs" sub={`A positive reply or account engagement of ${CONFIG.engagement.stages.MQA} alerts the owner with a fact-checked briefing, pauses automation for the whole account, and escalates after ${CONFIG.handoff.ackSlaHours} hours.`} />
      <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Awaiting acknowledgement" value={open.length} accent="#7C3AED" />
        <Kpi label="Past SLA" value={overdue.length} accent={overdue.length ? "#DC2626" : "#10B981"} meta={`${CONFIG.handoff.ackSlaHours}h acknowledgement deadline`} />
        <Kpi label="Total handoffs" value={handoffs.length} accent="#4F46E5" />
        <Kpi label="Closed deals" value={`${closed}/${CONFIG.handoff.retuneMinClosedDeals}`} accent="#10B981" meta="Needed before scoring weights retune" />
      </div>

      <div className="mt-5 grid gap-4">
        {handoffs.length === 0 ? <Card><Empty icon={<Handshake size={20} />} title="No handoffs yet" sub="They appear when an account reaches MQA or someone replies positively." /></Card> : handoffs.map((h) => {
          const b = h.briefing as unknown as Brief;
          const late = !h.acknowledgedAt && h.ackDueAt && h.ackDueAt < new Date();
          return (
            <section key={h.id} className="glass-card-static card-pad" style={{ borderLeft: `4px solid ${h.acknowledgedAt ? "#10B981" : late ? "#EF4444" : "#7C3AED"}` }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={h.account.name} id={h.account.id} size={44} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><Link href={`/accounts/${h.accountId}`} className="text-base font-bold hover:underline" style={{ color: "var(--text-primary)" }}>{h.account.name}</Link><StageBadge stage={h.account.stage} /><Badge color="#4F46E5">{h.trigger.replace("_", " ")}</Badge></div>
                    <div className="muted mt-0.5 text-xs">To {h.owner?.name ?? "unassigned queue"} · {ago(h.createdAt)}{h.escalatedAt ? " · escalated to manager" : ""}</div>
                  </div>
                </div>
                {h.blocked ? <Badge color="#DC2626">blocked by guardrail</Badge> : h.acknowledgedAt ? <Badge color="#059669">acknowledged {ago(h.acknowledgedAt)}</Badge> : (
                  <div className="flex items-center gap-2">
                    {late && <span className="flex items-center gap-1 text-xs font-semibold text-[#DC2626]"><AlertTriangle size={13} />Past SLA</span>}
                    <ActionButton action={ackHandoffAction.bind(null, h.id)} className="btn btn-success btn-sm"><Check size={14} /> Acknowledge</ActionButton>
                  </div>
                )}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <div className="micro mb-1">Why now</div>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{b.whyNow}</p>
                  <div className="micro mb-1 mt-3">Strongest facts (each cites evidence)</div>
                  <ul className="grid gap-1 text-sm secondary">{b.facts.map((f) => <li key={f.factId}>· {f.text}</li>)}</ul>
                </div>
                <div className="grid content-start gap-3 text-sm">
                  <div><div className="micro mb-1">Who engaged</div>{b.engaged.length ? b.engaged.map((e) => <div key={e.name} className="secondary">{e.name}{e.title ? ` · ${e.title}` : ""} <span className="muted text-xs">({e.signals.map((s) => s.replaceAll("_", " ")).join(", ")})</span></div>) : <span className="muted">—</span>}{b.anonymousSignals ? <div className="muted text-xs">+ {b.anonymousSignals} anonymous signals</div> : null}</div>
                  <div><div className="micro mb-1">Still unknown</div><span className="secondary">{b.unknowns.length ? b.unknowns.map((u) => u.replace("_", " ")).join(", ") : "Nothing open"}</span></div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
