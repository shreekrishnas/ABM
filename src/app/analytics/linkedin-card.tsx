import { Card } from "@/components/ui";
import { linkedinMetrics } from "@/lib/linkedin/metrics";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

/** LinkedIn messaging outcomes (last 90 days): conversations started, not messages sent. */
export async function LinkedInPerformance() {
  const m = await linkedinMetrics(90);
  const tiles = [
    { k: "Messages sent", v: String(m.sent), sub: `${m.drafts} drafted` },
    { k: "Reply rate", v: pct(m.replied, m.sent), sub: `${m.replied} replied within 14 days` },
    { k: "Meaningful conversations", v: pct(m.meaningful, m.sent), sub: "replies that weren't neutral or out-of-office" },
    { k: "Explicit interest", v: String(m.explicitInterest), sub: `${m.handoffs} hand-off signal${m.handoffs === 1 ? "" : "s"} from LinkedIn` },
    { k: "Drafts edited", v: pct(m.edited, m.sent), sub: m.avgChange != null ? `about ${Math.round(m.avgChange * 100)}% of the text changed` : "no edits yet" },
    { k: "Drafts blocked", v: pct(m.blocked, m.drafts), sub: m.topBlock ? `most often: ${m.topBlock.toLowerCase()}` : "none" },
  ];
  return (
    <Card title="LinkedIn conversations · last 90 days" sub="Measured on conversations started, not volume. What works feeds back to the writer as style advice only; every claim still needs a fact and every message a person." className="xl:col-span-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.k} className="rounded-xl px-3 py-2" style={{ background: "var(--surface-card-header)" }}>
            <div className="muted text-xs">{t.k}</div>
            <div className="tnum text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{t.v}</div>
            <div className="muted text-xs">{t.sub}</div>
          </div>
        ))}
      </div>
      {m.sent > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[{ title: "By message type", rows: m.byKind.map((r) => ({ name: r.label, ...r })) }, { title: "By sender", rows: m.bySender.map((r) => ({ name: r.sender, ...r })) }].map((t) => (
            <div key={t.title}>
              <div className="mb-1 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{t.title}</div>
              <table className="data text-xs"><thead><tr><th></th><th>Sent</th><th>Replied</th><th>Meaningful</th></tr></thead>
                <tbody>{t.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="tnum">{r.sent}</td><td className="tnum">{pct(r.replied, r.sent)}</td><td className="tnum">{pct(r.meaningful, r.sent)}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
