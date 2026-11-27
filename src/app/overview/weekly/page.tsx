import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, FileText, Globe, Sparkles, Star } from "lucide-react";
import { db } from "@/lib/db";
import { activeSellerId } from "@/lib/scope";
import { weeklyReport } from "@/lib/reports/weekly";
import type { GlanceTone } from "@/lib/accounts/glance";
import { Card, Empty, PageHeader, TierBadge } from "@/components/ui";
import { PrintButton } from "./print-button";

export const metadata = { title: "Weekly report" };

const TONE: Record<GlanceTone, { fg: string; bg: string }> = {
  good: { fg: "var(--success-strong)", bg: "var(--success-bg)" },
  maybe: { fg: "var(--warning-strong)", bg: "var(--warning-bg)" },
  weak: { fg: "var(--text-secondary)", bg: "var(--surface-card-header)" },
  stop: { fg: "var(--danger-strong)", bg: "var(--danger-bg)" },
  none: { fg: "var(--text-secondary)", bg: "var(--surface-card-header)" },
};
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default async function WeeklyReportPage() {
  const [report, client] = await Promise.all([
    weeklyReport(),
    activeSellerId().then((id) => db.client.findUnique({ where: { id }, select: { name: true } }).catch(() => null)),
  ]);
  const { numbers: n } = report;
  const period = `${day(report.from)} – ${day(report.to)} ${report.to.getFullYear()}`;
  const stats = [
    { label: "Companies added", value: n.added },
    { label: "Companies researched", value: n.researched },
    { label: "Companies on the website", value: n.visitors },
    { label: "Drafts waiting", value: n.draftsWaiting },
    { label: "Emails sent", value: n.emailsSent },
    { label: "Replies", value: n.replies },
  ];

  return (
    <div className="page-enter weekly-report">
      <PageHeader
        eyebrow={client?.name ? `Weekly report · ${client.name}` : "Weekly report"}
        title={`This week: ${period}`}
        sub="The best accounts and why, what research found, who visited the website, and the drafts waiting for a decision."
        actions={<PrintButton />}
      />

      <section className="wr-stats mb-5" aria-label="This week in numbers">
        {stats.map((s) => (
          <div key={s.label} className="wr-stat">
            <b className="tnum">{s.value.toLocaleString()}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </section>

      <Card title={<span className="wr-h"><Star size={16} aria-hidden /> Top accounts to work on</span>} sub="Highest priority first: fit, buying signals, company value and timing together" className="mb-5">
        {report.top.length === 0 ? <Empty title="No scored companies yet" sub="Companies appear here once research has scored them." /> : (
          <ol className="wr-top">
            {report.top.map((a, i) => {
              const t = TONE[a.glance.verdict.tone];
              return (
                <li key={a.id} className="wr-acc">
                  <span className="wr-rank tnum" aria-hidden>{i + 1}</span>
                  <div className="min-w-0">
                    <div className="wr-acc-head">
                      <Link href={`/accounts/${a.id}`} className="wr-acc-name">{a.name}</Link>
                      <span className="wr-pill" style={{ color: t.fg, background: t.bg }}>{a.glance.verdict.label}</span>
                      <TierBadge tier={a.tier as never} />
                      {a.priority != null && <span className="muted text-xs tnum">Priority {a.priority}</span>}
                    </div>
                    <dl className="wr-acc-grid">
                      <div><dt>Why now</dt><dd>{a.glance.whyNow ?? <span className="muted">No buying signal found yet</span>}</dd></div>
                      <div><dt>Who to contact</dt><dd>{a.glance.contact ? <>{a.glance.contact.name}<span className="muted">{a.glance.contact.title ? ` · ${a.glance.contact.title}` : ""}</span></> : <span className="muted">Not found yet</span>}</dd></div>
                      <div><dt>Next step</dt><dd>{a.glance.next}</dd></div>
                    </dl>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title={<span className="wr-h"><Sparkles size={16} aria-hidden /> What research found this week</span>} sub={report.changes.length ? `${report.changes.length} compan${report.changes.length === 1 ? "y" : "ies"} with new facts` : undefined}>
          {report.changes.length === 0 ? <Empty title="Nothing new this week" sub="New facts and negative news found by research show here." /> : (
            <ul className="wr-list">
              {report.changes.map((c) => (
                <li key={c.id}>
                  <Link href={`/accounts/${c.id}`} className="wr-li-name">{c.name}</Link>
                  {c.negatives.map((x, k) => <div key={`n${k}`} className="wr-neg"><AlertTriangle size={13} aria-hidden /><span className="min-w-0">{x}</span></div>)}
                  <ul className="wr-sub">{c.items.map((x, k) => <li key={k}>{x}</li>)}</ul>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid content-start gap-5">
          <Card title={<span className="wr-h"><Globe size={16} aria-hidden /> Companies on the website</span>} sub={n.visitors ? `${n.visitors} this week, most visits first` : undefined}>
            {report.visitors.length === 0 ? <Empty title="No identified visitors this week" /> : (
              <ul className="wr-list">
                {report.visitors.map((v) => (
                  <li key={`${v.name}|${v.domain}`} className="wr-row">
                    <span className="min-w-0">
                      {v.accountId ? <Link href={`/accounts/${v.accountId}`} className="wr-li-name">{v.name}</Link> : <span className="wr-li-name">{v.name}</span>}
                      {v.domain && <span className="muted text-xs"> · {v.domain}</span>}
                    </span>
                    <span className="wr-row-end">
                      {v.accountId ? <span className="wr-tag in">In pipeline</span> : <span className="wr-tag">Not added</span>}
                      <span className="tnum muted text-xs">{v.visits} visit{v.visits === 1 ? "" : "s"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/import/apollo" className="wr-more no-print">All website visitors <ArrowRight size={13} aria-hidden /></Link>
          </Card>

          <Card title={<span className="wr-h"><FileText size={16} aria-hidden /> Drafts waiting for a decision</span>} sub={n.draftsWaiting ? `${n.draftsWaiting} in Approvals, oldest first` : undefined}>
            {report.drafts.length === 0 ? <Empty title="No drafts waiting" /> : (
              <ul className="wr-list">
                {report.drafts.map((d) => (
                  <li key={d.id}>
                    <Link href={`/accounts/${d.accountId}?tab=outreach`} className="wr-li-name">{d.subject}</Link>
                    <div className="muted text-xs">{d.person}{d.title ? `, ${d.title}` : ""} · {d.company} · since {day(d.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <p className="muted mt-5 flex items-center gap-1.5 text-xs"><Building2 size={13} aria-hidden /> Made from the data in ABM on {day(report.to)} {report.to.getFullYear()}. Nothing is sent to anyone from this page.</p>
    </div>
  );
}
