import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { ensureSellerPacks, seller } from "@/lib/seller";
import { classifyTrigger } from "@/lib/seller/fit";
import { HBars } from "@/components/charts";
import { StatStrip } from "@/components/v2";
import { STAGE_SHORT } from "@/lib/stage-docs";
import { Card, PageHeader, money } from "@/components/ui";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await ensureSellerPacks();
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

  // Leading indicator: reply rate by the angle (Manch trigger type) the draft led with.
  const sp = seller();
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

  const spend = (k: string) => (ledgerByKind.find((l) => l.kind === k)?._sum.amountMicros ?? 0) / 1e6;
  const totalSpend = spend("llm") + spend("lookup") + spend("verification");
  const stageSpend = ledgerByStage.sort((a, b) => a.stage - b.stage).map((s) => ({ label: STAGE_SHORT[s.stage] ?? `Stage ${s.stage}`, value: Math.round(((s._sum.amountMicros ?? 0) / 1e6) * 100) / 100 }));

  return (
    <div className="page-enter">
      <PageHeader eyebrow="Learning loop" title="Analytics" sub={`Leading indicators you can act on from day one. Scoring weights only retune after ${CONFIG.handoff.retuneMinClosedDeals} closed deals (${closed} so far) and a baseline test.`} />
      <StatStrip items={[
        { label: "Total spend", value: `$${totalSpend.toFixed(2)}`, meta: "AI + lookups + verification" },
        { label: "AI (research and writing)", value: `$${spend("llm").toFixed(2)}`, meta: `${ledgerByKind.find((l) => l.kind === "llm")?._count ?? 0} calls` },
        { label: "Paid lookups", value: `$${spend("lookup").toFixed(2)}`, meta: "Only for missing fields" },
        { label: "Emails sent", value: messages.length, meta: `${replies.length} replies` },
      ]} />

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
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
        <Card title="Reply classes" sub="How replies were routed">
          <HBars data={replyClasses} unit="replies" height={220} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
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
        <Card title="Spend by stage" sub="Where the per-account budget goes">
          <HBars data={stageSpend} unit="USD" height={Math.max(160, stageSpend.length * 34)} />
        </Card>
      </div>
    </div>
  );
}
