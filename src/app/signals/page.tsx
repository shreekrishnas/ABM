import Link from "next/link";
import { Radar } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, Kpi, PageHeader, StageBadge, ago } from "@/components/ui";
import { recordSignalAction } from "../actions";

export const metadata = { title: "Signals" };

export default async function SignalsPage() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [signals, byType, anon, accounts, surging] = await Promise.all([
    db.signal.findMany({ orderBy: { occurredAt: "desc" }, take: 80, include: { account: true, contact: true } }),
    db.signal.groupBy({ by: ["type"], where: { occurredAt: { gte: since } }, _count: true, _sum: { points: true } }),
    db.signal.count({ where: { anonymous: true, occurredAt: { gte: since } } }),
    db.account.findMany({ where: { mergedIntoId: null, stage: { notIn: ["DISQUALIFIED"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { mergedIntoId: null, intentScore: { gte: CONFIG.intent.surgeThreshold } }, orderBy: { intentScore: "desc" }, take: 8 }),
  ]);
  const total = byType.reduce((a, t) => a + t._count, 0);

  return (
    <div className="page-enter">
      <PageHeader eyebrow="Continuous" title="Signals" sub="Intent, website visits, job changes and engagement feed one account-level score. Anonymous and uncontacted activity counts at half weight instead of being thrown away." />
      <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Signals (30d)" value={total} meta={`${anon} anonymous`} />
        <Kpi label="Intent surging" value={surging.length} accent="#0EA5E9" meta={`Intent ≥ ${CONFIG.intent.surgeThreshold}`} />
        <Kpi label="Pricing visits (30d)" value={byType.find((t) => t.type === "pricing_visit")?._count ?? 0} accent="#7C3AED" meta={`+${CONFIG.engagement.points.pricing_visit} pts each`} />
        <Kpi label="Half-life" value={`${CONFIG.engagement.halfLifeDays}d`} accent="#10B981" meta={`MQA at ${CONFIG.engagement.stages.MQA} points`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Signal feed" pad={false} className="xl:col-span-2">
          {signals.length === 0 ? <Empty icon={<Radar size={20} />} title="No signals yet" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Account</th><th>Signal</th><th>Who</th><th>Points</th><th>Counts toward</th><th>When</th></tr></thead>
                <tbody>
                  {signals.map((s) => (
                    <tr key={s.id}>
                      <td className="strong"><Link href={`/accounts/${s.accountId}?tab=activity`} className="hover:underline">{s.account.name}</Link></td>
                      <td>{s.type.replaceAll("_", " ")}{s.detail && <div className="muted max-w-[200px] truncate text-xs">{s.detail}</div>}</td>
                      <td>{s.contact?.fullName ?? <span className="muted">anonymous</span>}</td>
                      <td className="tnum">+{s.points}</td>
                      <td>{s.attributed && !s.anonymous ? <Badge color="#7C3AED">person + account</Badge> : <Badge color="#0EA5E9">account (½ weight)</Badge>}</td>
                      <td className="muted whitespace-nowrap text-xs">{ago(s.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="grid content-start gap-5">
          <Card title="Record a signal" sub="Tracking script and intent provider will post here automatically via /api/v1/signals">
            <ActionForm action={recordSignalAction} className="grid gap-3">
              <div><label className="field-label" htmlFor="sa">Account</label>
                <select id="sa" name="accountId" className="glass-select" required defaultValue=""><option value="" disabled>Choose an account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </div>
              <div><label className="field-label" htmlFor="st">Type</label>
                <select id="st" name="type" className="glass-select" defaultValue="site_visit">{Object.entries(CONFIG.engagement.points).map(([k, p]) => <option key={k} value={k}>{k.replaceAll("_", " ")} (+{p})</option>)}</select>
              </div>
              <div><label className="field-label" htmlFor="sd">Detail</label><input id="sd" name="detail" className="glass-input" placeholder="/pricing, webinar name…" /></div>
              <div className="flex justify-end"><SubmitButton>Record</SubmitButton></div>
            </ActionForm>
          </Card>
          <Card title="Intent surging" sub="Watched accounts with a surge are re-researched early">
            {surging.length === 0 ? <span className="muted text-sm">None right now</span> : (
              <ul className="grid gap-2">
                {surging.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/accounts/${a.id}`} className="font-semibold hover:underline" style={{ color: "var(--text-primary)" }}>{a.name}</Link>
                    <span className="flex items-center gap-2"><StageBadge stage={a.stage} /><span className="tnum font-semibold">{Math.round(a.intentScore)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
