import Link from "next/link";
import { ArrowRight, Building2, CircleDollarSign, ClipboardCheck, Flame, MessageSquareReply, Target, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { STAGES } from "@/lib/config";
import { AreaTrend, HBars, TierDonut, VBars } from "@/components/charts";
import { STAGE_STYLE, Avatar, Card, Empty, Kpi, Meter, PageHeader, StageBadge, TierBadge, ago, money } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { runAllAction, tickAction } from "../actions";

const FUNNEL = ["UNAWARE", "AWARE", "ENGAGED", "MQA", "OPPORTUNITY", "CUSTOMER"] as const;

export default async function ProgramOverview() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [stageGroups, tierGroups, delivered, replies, positive, openOpps, wonOpps, reviews, spend, signals, blocks, hot, events, reviewItems] = await Promise.all([
    db.account.groupBy({ by: ["stage"], where: { mergedIntoId: null }, _count: true }),
    db.account.groupBy({ by: ["tier"], where: { mergedIntoId: null, tier: { not: null }, stage: { notIn: ["DISQUALIFIED", "CUSTOMER"] } }, _count: true }),
    db.message.count({ where: { status: { in: ["delivered", "bounced"] } } }),
    db.reply.count({ where: { class: { notIn: ["out_of_office"] } } }),
    db.reply.count({ where: { class: "positive" } }),
    db.opportunity.aggregate({ where: { stage: { notIn: ["won", "lost"] }, source: "abm" }, _sum: { amountUsd: true }, _count: true }),
    db.opportunity.aggregate({ where: { stage: "won" }, _sum: { amountUsd: true }, _count: true }),
    db.reviewItem.count({ where: { status: "open" } }),
    db.ledgerEntry.aggregate({ _sum: { amountMicros: true } }),
    db.signal.findMany({ where: { occurredAt: { gte: since30 } }, select: { occurredAt: true, points: true } }),
    db.pipelineEvent.groupBy({ by: ["stage"], where: { outcome: "block" }, _count: true }),
    db.account.findMany({ where: { mergedIntoId: null, stage: { in: ["AWARE", "ENGAGED", "MQA", "OPPORTUNITY"] } }, orderBy: { engagementScore: "desc" }, take: 6, include: { owner: true } }),
    db.pipelineEvent.findMany({ where: { outcome: { in: ["block", "pass"] }, step: { in: ["readiness.decide", "orchestrator.stop", "handoff.alert_owner", "sequence_send.send_once", "sequence_send.classify_reply", "fit_tier.exclusions"] } }, orderBy: { createdAt: "desc" }, take: 8, include: { account: true } }),
    db.reviewItem.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, take: 5, include: { account: true } }),
  ]);

  const byStage = Object.fromEntries(stageGroups.map((g) => [g.stage, g._count]));
  const target = stageGroups.filter((g) => !["DISQUALIFIED", "CUSTOMER"].includes(g.stage)).reduce((a, g) => a + g._count, 0);
  const funnel = FUNNEL.map((s) => ({ label: STAGE_STYLE[s].label, value: byStage[s] ?? 0 }));
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86_400_000);
    return { key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), value: 0 };
  });
  for (const s of signals) {
    const day = days.find((d) => d.key === s.occurredAt.toISOString().slice(0, 10));
    if (day) day.value += Math.round(s.points);
  }
  const blocksByStage = STAGES.slice(1).map((s) => ({ label: String(s.n), value: blocks.find((b) => b.stage === s.n)?._count ?? 0 }));
  const replyRate = delivered ? Math.round((replies / delivered) * 1000) / 10 : 0;
  const spendUsd = (spend._sum.amountMicros ?? 0) / 1_000_000;

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Program"
        title="Program overview"
        sub="Where every target account stands, what is blocked, and what the program is producing."
        actions={
          <>
            <ActionButton action={tickAction} className="btn btn-secondary">Run scheduler</ActionButton>
            <ActionButton action={runAllAction} className="btn btn-brand">Run pipeline on new accounts</ActionButton>
          </>
        }
      />

      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Target companies" value={target} icon={<Target size={16} />} meta={`${byStage.DISQUALIFIED ?? 0} disqualified · ${byStage.WATCH ?? 0} watching`} />
        <Kpi label="MQAs" value={byStage.MQA ?? 0} accent="#7C3AED" icon={<Flame size={16} />} meta={`${byStage.ENGAGED ?? 0} engaged, warming up`} />
        <Kpi label="Pipeline influenced" value={money(openOpps._sum.amountUsd ?? 0)} accent="#4F46E5" icon={<CircleDollarSign size={16} />} meta={`${openOpps._count} open · ${money(wonOpps._sum.amountUsd ?? 0)} won`} />
        <Kpi label="Reply rate" value={`${replyRate}%`} accent="#0EA5E9" icon={<MessageSquareReply size={16} />} meta={`${positive} positive of ${replies} replies`} />
        <Kpi label="Needs a person" value={reviews} accent={reviews > 10 ? "#DC2626" : "#F59E0B"} icon={<ClipboardCheck size={16} />} meta={<Link href="/review" className="hover:underline">Open review queue →</Link>} />
        <Kpi label="Spend to date" value={`$${spendUsd.toFixed(2)}`} accent="#10B981" icon={<Wallet size={16} />} meta={`$${target ? (spendUsd / Math.max(1, target)).toFixed(2) : "0.00"} per target account`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Buying-stage funnel" sub="Accounts by stage, account-level engagement" className="xl:col-span-2">
          <HBars data={funnel} unit="accounts" />
        </Card>
        <Card title="Active accounts by tier" sub="T1 1:1 · T2 1:few · T3 1:many">
          <TierDonut data={(["T1", "T2", "T3"] as const).map((t) => ({ label: t === "T1" ? "T1 · 1:1" : t === "T2" ? "T2 · 1:few" : "T3 · 1:many", value: tierGroups.find((g) => g.tier === t)?._count ?? 0 }))} />
          <p className="muted mt-4 text-xs leading-relaxed">Budgets per account: T1 $5.00, T2 $2.00, T3 $0.75. Tier sets research depth and approval policy.</p>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Engagement points, last 30 days" sub="All signals at all target accounts, including anonymous visits" className="xl:col-span-2">
          <AreaTrend data={days} unit="points" />
        </Card>
        <Card title="Gate blocks by stage" sub="Where records stop — every block is logged with a reason" action={<Link href="/pipeline" className="btn btn-ghost btn-sm">Pipeline <ArrowRight size={14} /></Link>}>
          <VBars data={blocksByStage} unit="blocks" />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Hottest accounts" sub="Highest account-level engagement" pad={false} className="xl:col-span-2" action={<Link href="/accounts?sort=engagement" className="btn btn-ghost btn-sm mr-5">All accounts <ArrowRight size={14} /></Link>}>
          {hot.length === 0 ? <Empty icon={<Building2 size={20} />} title="No engaged accounts yet" sub="Run the pipeline and approve drafts to start outreach." /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Account</th><th>Tier</th><th>Stage</th><th className="w-48">Engagement</th><th>Owner</th></tr></thead>
                <tbody>
                  {hot.map((a) => (
                    <tr key={a.id}>
                      <td className="strong"><Link href={`/accounts/${a.id}`} className="flex items-center gap-3 hover:underline"><Avatar name={a.name} id={a.id} size={30} />{a.name}</Link></td>
                      <td><TierBadge tier={a.tier} /></td>
                      <td><StageBadge stage={a.stage} /></td>
                      <td><div className="flex items-center gap-2"><div className="flex-1"><Meter value={a.engagementScore} /></div><span className="tnum w-9 text-right text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{Math.round(a.engagementScore)}</span></div></td>
                      <td>{a.owner?.name ?? <span className="muted">Unassigned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Waiting on a person" sub="Oldest first" action={<Link href="/review" className="btn btn-ghost btn-sm">Queue <ArrowRight size={14} /></Link>}>
          {reviewItems.length === 0 ? <Empty title="Queue is clear" sub="Nothing needs a human decision right now." /> : (
            <ul className="grid gap-2.5">
              {reviewItems.map((r) => (
                <li key={r.id} className="rounded-xl px-3 py-2.5" style={{ background: "var(--surface-card-header)", borderLeft: `3px solid ${r.type === "draft_approval" ? "#8B5CF6" : r.type === "budget_exceeded" ? "#EF4444" : "#F59E0B"}` }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="micro">{r.type.replaceAll("_", " ")}</span>
                    <span className="muted text-[0.7rem]">{ago(r.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[0.82rem] secondary">{r.reason}</div>
                  {r.account && <div className="mt-1 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{r.account.name}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent pipeline decisions" sub="Latest readiness, send, reply and handoff outcomes" className="mt-5">
        {events.length === 0 ? <Empty title="Nothing yet" /> : (
          <ul className="timeline">
            {events.map((e) => (
              <li key={e.id} className="tl-item" style={{ ["--tl" as string]: e.outcome === "block" ? "#F59E0B" : "#10B981" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[0.85rem]" style={{ color: "var(--text-primary)" }}>
                    {e.account ? <Link href={`/accounts/${e.account.id}`} className="font-semibold hover:underline">{e.account.name}</Link> : "System"}
                    <span className="secondary"> · {e.reason}</span>
                  </span>
                  <span className="mono muted">stage {e.stage} · {ago(e.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
