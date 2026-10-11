import { Globe } from "lucide-react";
import { visitSummary } from "@/lib/web/visits";
import { Card, Empty, ago } from "@/components/ui";

/** What a company (or one person) looked at on our website: topics, then pages. */
export async function WebVisitsCard({ accountId, contactId }: { accountId?: string; contactId?: string }) {
  const v = await visitSummary(contactId ? { contactId } : { accountId }, new Date(), 90);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Globe size={16} /> Website visits</span>} sub={v.total ? `${v.total} page view${v.total > 1 ? "s" : ""} in 90 days · last ${ago(v.last)}` : "From the tracking script and visitor tools"}>
      {v.total === 0 ? <Empty title="No visits seen yet" sub="Visits appear once the tracking script is on your website (Settings → Website tracking)." /> : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {v.topics.map((t) => <span key={t.key} className="chip" style={t.key === "pricing" || t.key === "demo" ? { ["--c" as string]: "var(--intent-hot)" } : undefined}>{t.label} · {t.count}</span>)}
          </div>
          <ul className="grid gap-1.5 text-sm">
            {v.pages.map((p, i) => (
              <li key={i} className="flex min-w-0 justify-between gap-3">
                <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>{p.title}{p.who && !contactId ? <span className="secondary"> · {p.who}</span> : null}</span>
                <span className="muted whitespace-nowrap text-xs">{ago(p.at)}</span>
              </li>
            ))}
          </ul>
          {v.interest && <p className="muted mt-3 text-xs">The writer uses these topics to choose the angle. Emails never mention the visit.</p>}
        </>
      )}
    </Card>
  );
}
