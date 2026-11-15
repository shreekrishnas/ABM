// "What's working": research and drafting, the parts of the program that run today.
import Link from "next/link";
import { Card } from "@/components/ui";
import { KpiRow, KpiTile } from "@/components/viz/cards";
import type { Working, Row } from "@/lib/insights/working";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const usd = (n: number | null) => (n == null ? "—" : n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const hours = (h: number | null) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

function Table({ rows, first }: { rows: Row[]; first: string }) {
  if (!rows.length) return <p className="muted so-pad text-sm">No emails reviewed yet.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>{first}</th><th className="r">Written</th><th className="r">Approved</th><th className="r">Edited first</th><th className="r">Rejected</th><th className="r">Approval rate</th></tr></thead>
        <tbody>{rows.map((r) => {
          const decided = r.approved + r.rejected;
          return (
            <tr key={r.label}>
              <td className="strong">{r.label}</td>
              <td className="r tnum">{r.total}</td>
              <td className="r tnum">{r.approved}</td>
              <td className="r tnum">{r.edited}</td>
              <td className="r tnum">{r.rejected}</td>
              <td className="r tnum">{decided ? pct(r.approved, decided) : <span className="muted">waiting</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export function WhatsWorking({ w }: { w: Working }) {
  const d = w.drafts;
  const decided = d.approved + d.rejected;
  const max = Math.max(1, ...w.funnel.map((x) => x.value));
  // The biggest drop between two steps: where to look first.
  let drop: { from: string; to: string; lost: number } | null = null;
  for (let i = 1; i < w.funnel.length; i++) {
    const lost = w.funnel[i - 1].value - w.funnel[i].value;
    if (lost > 0 && (!drop || lost > drop.lost)) drop = { from: w.funnel[i - 1].label, to: w.funnel[i].label, lost };
  }
  return (
    <section className="mb-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">What&apos;s working, last {w.days} days</h2>
        <p className="secondary text-sm">Research and email drafting for the client in view: what happens to companies, what the team approves, rejects or rewrites, and what it costs.</p>
      </div>
      <KpiRow>
        <KpiTile tint={0} label="Approval rate" value={decided ? pct(d.approved, decided) : "—"} note={decided ? `${d.approved} approved, ${d.rejected} rejected` : "nothing reviewed yet"} href="/review?type=draft_approval" />
        <KpiTile tint={1} label="Approved without edits" value={d.approved ? pct(d.approvedAsIs, d.approved) : "—"} note={`${d.edited} needed edits first`} />
        <KpiTile tint={2} label="Cost per approved email" value={usd(w.cost.perApproved)} note={`${usd(w.cost.total)} spent in total`} />
        <KpiTile tint={3} label="Approval wait" value={hours(w.wait.medianHours)} note={w.wait.oldestPendingDays != null ? `oldest waiting ${w.wait.oldestPendingDays.toFixed(1)} days` : "none waiting"} />
      </KpiRow>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="From company to approved email" sub={drop ? `Biggest drop: ${drop.lost} between "${drop.from}" and "${drop.to}". Start there.` : "Each step, for companies added or worked on in this period"}>
          <ul className="grid gap-2">
            {w.funnel.map((f) => (
              <li key={f.label} className="flex items-center gap-3">
                <span className="w-56 text-sm">{f.label}{f.note && <span className="muted block text-xs">{f.note}</span>}</span>
                <span className="h-2 flex-1 rounded-full bg-[var(--surface-hover)]"><span className="block h-2 rounded-full bg-[var(--accent-primary,#6366F1)]" style={{ width: `${f.value ? Math.max(2, Math.round((f.value / max) * 100)) : 0}%` }} /></span>
                <b className="tnum w-10 text-right">{f.value}</b>
              </li>
            ))}
          </ul>
          {(d.blocked > 0 || d.replaced > 0) && <p className="muted mt-3 text-xs">{d.blocked ? `${d.blocked} email${d.blocked === 1 ? "" : "s"} held by the checks (never shown for approval). ` : ""}{d.replaced ? `${d.replaced} replaced by a fresher version before approval.` : ""}</p>}
        </Card>
        <Card title="Why companies stop" sub="The latest stop for each company, grouped by reason" action={<Link href="/pipeline" className="btn btn-ghost btn-sm">Details</Link>}>
          {w.stops.length ? (
            <ul className="grid gap-1.5 text-sm">{w.stops.map((s) => <li key={s.reason} className="flex justify-between gap-3"><span>{s.reason}</span><b className="tnum">{s.count}</b></li>)}</ul>
          ) : <p className="muted text-sm">No company stopped in this period.</p>}
        </Card>
        <Card title="Which use cases the team approves" sub="By what each email pitched (what the signals pointed at)" pad={false}><Table rows={w.byUseCase} first="Use case" /></Card>
        <Card title="Which email shapes the team approves" sub="By how each email was built (what led)" pad={false}><Table rows={w.byShape} first="Shape" /></Card>
        <Card title="Why emails are rejected" sub="The reason given in Approvals; the writer learns from these">
          {w.rejections.length ? (
            <ul className="grid gap-1.5 text-sm">{w.rejections.map((r) => <li key={r.reason} className="flex justify-between gap-3"><span>{r.reason}</span><b className="tnum">{r.count}</b></li>)}</ul>
          ) : <p className="muted text-sm">No rejections in this period.</p>}
        </Card>
        <Card title="Website visitors" sub="Companies identified on your website in this period" action={<Link href="/import/apollo" className="btn btn-ghost btn-sm">Visitors</Link>}>
          <ul className="grid gap-1.5 text-sm">
            <li className="flex justify-between"><span>Companies that visited</span><b className="tnum">{w.visitors.companies}</b></li>
            <li className="flex justify-between"><span>Waiting for your approval</span><b className="tnum">{w.visitors.waiting}</b></li>
            <li className="flex justify-between"><span>Added for research</span><b className="tnum">{w.visitors.added}</b></li>
          </ul>
        </Card>
      </div>
      <p className="muted text-xs">Below: email results (sent, replies, deals). They fill in once sending is switched on.</p>
    </section>
  );
}
