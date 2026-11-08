import { SPEND_KINDS, metric } from "@/lib/metrics";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller } from "@/lib/scope";
import { classifyTrigger } from "@/lib/seller/fit";
import { HBars } from "@/components/charts";
import { Donut, GroupedBars, KpiRow, KpiTile, change, dayLabels, daily } from "@/components/viz/cards";
import { STAGE_SHORT } from "@/lib/stage-docs";
import { Card, PageHeader, money } from "@/components/ui";

export const metadata = { title: "Analytics" };

import { LinkedInPerformance } from "./linkedin-card";

export default async function AnalyticsPage() {
  await ensureSellerPacks();
  const now = new Date();
  const wk = new Date(now.getTime() - 7 * 86_400_000), wk2 = new Date(now.getTime() - 14 * 86_400_000);
  const [thisWeek, lastWeek] = await Promise.all([
    db.ledgerEntry.groupBy({ by: ["kind"], where: { createdAt: { gte: wk } }, _sum: { amountMicros: true } }),
    db.ledgerEntry.groupBy({ by: ["kind"], where: { createdAt: { gte: wk2, lt: wk } }, _sum: { amountMicros: true } }),
  ]);
  const wkSpend = (rows: typeof thisWeek, k?: string) => rows.filter((r) => !k || r.kind === k).reduce((t, r) => t + (r._sum.amountMicros ?? 0), 0) / 1e6;
  const [messages, replies, evidence, ledgerByKind, ledgerByStage, oppsByTier, accountsByTier, closed] = await Promise.all([
    db.message.findMany({ where: { status: { in: ["delivered", "bounced"] } }, include: { draft: true, contact: { include: { account: true } } } }),
    db.reply.findMany({ include: { message: { include: { draft: true } }, contact: { include: { account: true } } } }),
    db.evidence.findMany({ where: { key: "trigger" }, select: { id: true, value: true, claim: true } }),
    db.ledgerEntry.groupBy({ by: ["kind"], _sum: { amountMicros: true }, _count: true }),
    db.ledgerEntry.groupBy({ by: ["stage"], _sum: { amountMicros: true } }),
    db.opportunity.findMany({ include: { account: true } }),
    db.account.groupBy({ by: ["tier"], where: { mergedIntoId: null, tier: { not: null } }, _count: true }),
    db.opportunity.count({ where: { stage: { in: ["won", "lost"] } } }),
  ]);

  // Leading indicator: reply rate by the angle (the seller's trigger type) the draft led with.
  const sp = await activeSeller();
  const leadClaim = new Map(evidence.map((e) => [e.id, e.claim]));
  const angle = (d: { angle: string | null; leadEvidenceId: string | null }) => {
    const byKey = d.angle ? sp.triggers.find((t) => t.key === d.angle) : undefined;
    if (byKey) return byKey.label;
    const c = d.leadEvidenceId ? leadClaim.get(d.leadEvidenceId) : null;
    return (c && classifyTrigger(c, sp)?.label) || "Other";
  };
  const angleStats = new Map<string, { sent: number; replied: number; positive: number }>();
  for (const m of messages) {
    const k = angle(m.draft);
    const s = angleStats.get(k) ?? { sent: 0, replied: 0, positive: 0 };
    s.sent++;
    angleStats.set(k, s);
  }
  for (const r of replies) {
    if (!r.message || r.class === "out_of_office") continue;
    const k = angle(r.message.draft);
    const s = angleStats.get(k) ?? { sent: 0, replied: 0, positive: 0 };
    s.replied++;
    if (r.class === "positive") s.positive++;
    angleStats.set(k, s);
  }
  const replyClasses = Object.entries(replies.reduce<Record<string, number>>((a, r) => ({ ...a, [r.class]: (a[r.class] ?? 0) + 1 }), {})).map(([label, value]) => ({ label: label.replace("_", " "), value }));

  const tierRows = (["T1", "T2", "T3"] as const).map((t) => {
    const sent = messages.filter((m) => m.contact.account.tier === t).length;
    const rep = replies.filter((r) => r.contact.account.tier === t && r.class !== "out_of_office").length;
    const opps = oppsByTier.filter((o) => o.account.tier === t);
    const won = opps.filter((o) => o.stage === "won");
    return { tier: t, accounts: accountsByTier.find((a) => a.tier === t)?._count ?? 0, sent, rate: sent ? Math.round((rep / sent) * 100) : 0, pipeline: opps.filter((o) => !["won", "lost"].includes(o.stage)).reduce((a, o) => a + o.amountUsd, 0), won: won.reduce((a, o) => a + o.amountUsd, 0) };
  });

  const sentWeek = messages.filter((m) => m.sentAt && m.sentAt >= wk).length;
  const sentPrevWeek = messages.filter((m) => m.sentAt && m.sentAt >= wk2 && m.sentAt < wk).length;
  const spend = (k: string) => (ledgerByKind.find((l) => l.kind === k)?._sum.amountMicros ?? 0) / 1e6;
  // One definition everywhere: every cost recorded (AI, web search, paid lookups, verification).
  const totalSpend = SPEND_KINDS.reduce((t, k) => t + spend(k), 0);
  const stageSpend = ledgerByStage.sort((a, b) => a.stage - b.stage).map((s) => ({ label: STAGE_SHORT[s.stage] ?? `Stage ${s.stage}`, value: Math.round(((s._sum.amountMicros ?? 0) / 1e6) * 100) / 100 }));

  return (
    <div className="page-enter">
      <PageHeader eyebrow="Learning loop" title="Analytics" sub={`Leading indicators you can act on from day one. Scoring weights only retune after ${CONFIG.handoff.retuneMinClosedDeals} closed deals (${closed} so far) and a baseline test.`} />
      <KpiRow>
        <KpiTile tint={0} label={metric("spend_total").label} period="All time" value={`$${totalSpend.toFixed(2)}`} pct={change(wkSpend(thisWeek), wkSpend(lastWeek))} goodWhenUp={false} note="this week vs last" />
        <KpiTile tint={1} label="AI (research and writing)" period="All time" value={`$${spend("llm").toFixed(2)}`} pct={change(wkSpend(thisWeek, "llm"), wkSpend(lastWeek, "llm"))} goodWhenUp={false} note={`${ledgerByKind.find((l) => l.kind === "llm")?._count ?? 0} calls`} />
        <KpiTile tint={2} label="Web search" period="All time" value={`$${spend("search").toFixed(2)}`} pct={change(wkSpend(thisWeek, "search"), wkSpend(lastWeek, "search"))} goodWhenUp={false} note={`${ledgerByKind.find((l) => l.kind === "search")?._count ?? 0} searches`} />
        <KpiTile tint={3} label="Emails sent" period="All time" value={messages.length} pct={change(sentWeek, sentPrevWeek)} note={`${replies.length} replies`} />
      </KpiRow>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Emails and replies" sub="Last 7 days" className="xl:col-span-2">
          <GroupedBars categories={dayLabels(7, now)} series={[{ name: "Emails sent", values: daily(messages.map((m) => m.sentAt).filter((d): d is Date => Boolean(d)), 7, now) }, { name: "Replies", values: daily(replies.map((r) => r.receivedAt), 7, now) }]} empty="No emails sent in the last 7 days." />
        </Card>
        <Card title="Reply types" sub="How replies were routed">
          <Donut data={replyClasses} center="of replies" empty="No replies yet. This fills once emails are sent." />
        </Card>
      </div>

      <div className="mt-5 grid gap-5">
        <Card title="Reply rate by angle" sub="Which trigger type, used as the lead, gets answers" pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Angle</th><th>Sent</th><th>Replied</th><th>Positive</th><th>Reply rate</th></tr></thead>
              <tbody>
                {[...angleStats.entries()].sort((a, b) => b[1].sent - a[1].sent).map(([k, s]) => (
                  <tr key={k}><td className="strong">{k}</td><td className="tnum">{s.sent}</td><td className="tnum">{s.replied}</td><td className="tnum">{s.positive}</td><td className="tnum font-semibold" style={{ color: "var(--text-primary)" }}>{s.sent ? Math.round((s.replied / s.sent) * 100) : 0}%</td></tr>
                ))}
                {angleStats.size === 0 && <tr><td colSpan={5} className="muted">No sends yet</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <LinkedInPerformance />
        <Card title="Results by tier" sub="Is 1:1 effort paying off versus 1:many?" pad={false} className="xl:col-span-2">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Tier</th><th>Accounts</th><th>Sends</th><th>Reply rate</th><th>Open pipeline</th><th>Won</th><th>Budget / account</th></tr></thead>
              <tbody>
                {tierRows.map((r) => (
                  <tr key={r.tier}><td className="strong">{r.tier}</td><td className="tnum">{r.accounts}</td><td className="tnum">{r.sent}</td><td className="tnum">{r.rate}%</td><td className="tnum">{money(r.pipeline)}</td><td className="tnum">{money(r.won)}</td><td className="tnum">${CONFIG.budgetsUsd[r.tier].toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`Spend by stage · $${stageSpend.reduce((t, x) => t + x.value, 0).toFixed(2)} total`} sub="Where the per-account budget goes (all recorded costs, every stage)">
          <HBars data={stageSpend} unit="USD" empty="No spend recorded yet." height={Math.max(160, stageSpend.length * 34)} />
        </Card>
      </div>
    </div>
  );
}
