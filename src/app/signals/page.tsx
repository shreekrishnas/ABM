import Link from "next/link";
import { SignalType } from "@prisma/client";
import { ListTodo, Radar } from "lucide-react";
import { AddTaskButton } from "@/components/shell/QuickTask";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, Empty, Kpi, PageHeader, StageBadge, ago } from "@/components/ui";
import { recordSignalAction } from "../actions";
import { ListKeys } from "@/components/peek/list-keys";
import { PeekPanel, peekHref } from "@/components/peek/panel";

export const metadata = { title: "Signals" };

/** "pricing_visit" → "Pricing page"; anything else in plain words. */
const WORD: Record<string, string> = { site_visit: "Site visit", pricing_visit: "Pricing page", demo_visit: "Demo page", email_open: "Email open", email_click: "Email click", email_reply: "Email reply", intent_surge: "Intent surge", job_change: "Job change" };
function signalWord(type: string) {
  return WORD[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

type Sig = { id: string; accountId: string; account: { name: string }; contact: { id: string; fullName: string } | null; type: string; detail: string | null; points: number; occurredAt: Date; anonymous: boolean };

/** One entry per company: total points, kinds of activity, who, and the signals themselves. */
function groupByCompany(signals: Sig[]) {
  const by = new Map<string, { accountId: string; name: string; points: number; last: Date; anonymous: number; people: string[]; kinds: Map<string, number>; items: Sig[] }>();
  for (const s of signals) {
    const g = by.get(s.accountId) ?? { accountId: s.accountId, name: s.account.name, points: 0, last: s.occurredAt, anonymous: 0, people: [] as string[], kinds: new Map<string, number>(), items: [] as Sig[] };
    g.points += s.points;
    if (s.occurredAt > g.last) g.last = s.occurredAt;
    if (s.anonymous || !s.contact) g.anonymous++;
    else if (!g.people.includes(s.contact.fullName)) g.people.push(s.contact.fullName);
    g.kinds.set(s.type, (g.kinds.get(s.type) ?? 0) + 1);
    g.items.push(s);
    by.set(s.accountId, g);
  }
  return [...by.values()].map((g) => ({ ...g, kinds: [...g.kinds].sort((a, b) => b[1] - a[1]) })).sort((a, b) => b.points - a.points);
}

export default async function SignalsPage({ searchParams }: { searchParams: Promise<{ peek?: string; view?: string; type?: string }> }) {
  const { peek, view: v, type } = await searchParams;
  const view = v === "all" ? "all" : "company";
  const sigType = (Object.values(SignalType) as string[]).includes(type ?? "") ? (type as SignalType) : undefined;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [signals, byType, anon, accounts, surging] = await Promise.all([
    db.signal.findMany({ where: view === "all" ? (sigType ? { type: sigType } : {}) : { occurredAt: { gte: since } }, orderBy: { occurredAt: "desc" }, take: view === "all" ? 100 : 2000, include: { account: true, contact: true } }),
    db.signal.groupBy({ by: ["type"], where: { occurredAt: { gte: since } }, _count: true, _sum: { points: true } }),
    db.signal.count({ where: { anonymous: true, occurredAt: { gte: since } } }),
    db.account.findMany({ where: { mergedIntoId: null, stage: { notIn: ["DISQUALIFIED"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.account.findMany({ where: { mergedIntoId: null, intentScore: { gte: CONFIG.intent.surgeThreshold } }, orderBy: { intentScore: "desc" }, take: 8 }),
  ]);
  const total = byType.reduce((a, t) => a + t._count, 0);

  return (
    <div className="page-enter">
      <ListKeys />
      <PeekPanel peek={peek} close="/signals" />
      <PageHeader eyebrow="Continuous" title="Signals" sub={`Intent, website visits, job changes and engagement feed one account-level score. Anonymous activity counts at half weight. Signals fade with a ${CONFIG.engagement.halfLifeDays}-day half-life; sales-ready at ${CONFIG.engagement.stages.MQA} points.`} />
      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Signals (30d)" value={total} meta={`${anon} anonymous`} />
        <Kpi label="Intent surging" value={surging.length} accent="#0EA5E9" meta={`Intent ≥ ${CONFIG.intent.surgeThreshold}`} />
        <Kpi label="Pricing visits (30d)" value={byType.find((t) => t.type === "pricing_visit")?._count ?? 0} accent="#7C3AED" meta={`+${CONFIG.engagement.points.pricing_visit} pts each`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Signal feed" sub={view === "company" ? "Last 30 days, one row per company, most points first. Open a row to see each signal." : "Every signal, newest first."} pad={false} className="xl:col-span-2"
          action={<nav className="k-seg sg-seg" aria-label="View"><Link href="/signals" className={view === "company" ? "on" : undefined}>By company</Link><Link href="/signals?view=all" className={view === "all" ? "on" : undefined}>All signals</Link></nav>}>
          {view === "all" && (
            <div className="sg-types">
              <Link href="/signals?view=all" className={`chip-filter${!sigType ? " on" : ""}`}>All types</Link>
              {byType.sort((x, y) => y._count - x._count).map((t) => <Link key={t.type} href={`/signals?view=all&type=${t.type}`} className={`chip-filter${sigType === t.type ? " on" : ""}`}>{signalWord(t.type)} <b className="tnum">{t._count}</b></Link>)}
            </div>
          )}
          {signals.length === 0 ? <Empty icon={<Radar size={20} />} title="No signals yet" /> : view === "company" ? (
            <ul className="sg-list">
              {groupByCompany(signals).map((g) => (
                <li key={g.accountId}>
                  <details>
                    <summary>
                      <span className="sg-co"><Link href={peekHref("/signals", {}, "a", g.accountId)} scroll={false}>{g.name}</Link><small>{g.people.length ? g.people.slice(0, 3).join(", ") + (g.people.length > 3 ? ` +${g.people.length - 3}` : "") : "No named person"}{g.anonymous ? ` · ${g.anonymous} anonymous` : ""}</small></span>
                      <span className="sg-kinds">{g.kinds.slice(0, 4).map(([k, n]) => <span key={k}>{signalWord(k)}{n > 1 ? ` ×${n}` : ""}</span>)}</span>
                      <span className="sg-pts tnum">+{g.points}</span>
                      <span className="sg-when">{ago(g.last)}</span>
                    </summary>
                    <ul className="sg-items">
                      {g.items.slice(0, 12).map((x) => (
                        <li key={x.id}>
                          <span>{signalWord(x.type)}{x.detail ? <span className="muted"> · {x.detail}</span> : null}</span>
                          <span className="muted">{x.contact ? x.contact.fullName : "anonymous · counts half"}</span>
                          <span className="tnum">+{x.points}</span>
                          <span className="muted">{ago(x.occurredAt)}</span>
                        </li>
                      ))}
                      {g.items.length > 12 && <li className="muted">and {g.items.length - 12} more</li>}
                    </ul>
                    <div className="sg-act"><Link href={`/accounts/${g.accountId}?tab=activity`} className="td2-link">Open company activity</Link><AddTaskButton target={{ accountId: g.accountId, label: g.name, title: `Follow up: ${g.name} is active`, origin: "signal" }} /></div>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <div className="table-wrap">
              <table className="data compact">
                <thead><tr><th>Company</th><th>Signal</th><th>Who</th><th className="text-right">Points</th><th>When</th><th></th></tr></thead>
                <tbody>
                  {signals.map((s) => (
                    <tr key={s.id} data-row-select={peekHref("/signals", { view: "all", type }, "a", s.accountId)} data-selected={peek === `a_${s.accountId}` ? "" : undefined}>
                      <td className="strong whitespace-nowrap"><Link href={peekHref("/signals", { view: "all", type }, "a", s.accountId)} scroll={false} className="hover:underline">{s.account.name}</Link></td>
                      <td>{signalWord(s.type)}{s.detail && <div className="muted max-w-[220px] truncate text-xs">{s.detail}</div>}</td>
                      <td className="whitespace-nowrap">{s.contact ? <Link href={peekHref("/signals", { view: "all", type }, "p", s.contact.id)} scroll={false} className="hover:underline">{s.contact.fullName}</Link> : <span className="muted">anonymous · counts half</span>}</td>
                      <td className="tnum text-right">+{s.points}</td>
                      <td className="muted whitespace-nowrap text-xs">{ago(s.occurredAt)}</td>
                      <td><AddTaskButton target={{ accountId: s.accountId, contactId: s.contact?.id, label: s.contact?.fullName ?? s.account.name, title: `Follow up: ${signalWord(s.type).toLowerCase()}${s.contact ? ` by ${s.contact.fullName}` : ""}`, origin: "signal" }} className="br-icon"><ListTodo size={15} /></AddTaskButton></td>
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
                <select id="st" name="type" className="glass-select" defaultValue="site_visit">{Object.entries(CONFIG.engagement.points).map(([k, p]) => <option key={k} value={k}>{signalWord(k)} (+{p})</option>)}</select>
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
