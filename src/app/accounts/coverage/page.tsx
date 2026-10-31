import Link from "next/link";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { Card, Empty, PageHeader, TierBadge } from "@/components/ui";
import { seller } from "@/lib/seller";
import { stakeholderMap, targetGroups } from "@/lib/buying-group/stakeholders";
import { ROLES, STATUS_COLOR, STATUS_ORDER, contactStatuses, roleCoverage } from "@/lib/buying-group/coverage";

export const metadata = { title: "Buying-group coverage" };

/** Company × role heatmap: where each buying group is covered, and where it has gaps. */
export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ gaps?: string; tier?: string }> }) {
  const sp = await searchParams;
  const accounts = await db.account.findMany({
    where: { mergedIntoId: null, stage: { notIn: ["DISQUALIFIED"] }, ...(sp.tier ? { tier: sp.tier as "T1" | "T2" | "T3" } : {}) },
    orderBy: [{ tier: "asc" }, { intentScore: "desc" }], take: 300,
    select: { id: true, name: true, tier: true, stage: true, outreachPausedUntil: true },
  });
  const byAccount = await contactStatuses(accounts.map((a) => a.id));
  // Stakeholder groups covered per company (leadership, IT, finance, procurement, operations, data, risk, channel, HR).
  const groups = targetGroups(seller().personas.flatMap((p) => p.functions));
  const titles = await db.contact.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, mergedIntoId: null }, select: { id: true, accountId: true, fullName: true, title: true, titleNormalized: true, buyingRole: true, stakeholderType: true, discoveredBy: true } });
  const groupCover = new Map(accounts.map((a) => [a.id, stakeholderMap(titles.filter((t) => t.accountId === a.id).map((t) => ({ ...t, title: t.titleNormalized ?? t.title })), groups)]));
  const eligible = CONFIG.readiness.eligibleRoles as readonly string[];
  let rows = accounts.map((a) => ({ a, cov: roleCoverage(byAccount.get(a.id) ?? []) }));
  if (sp.gaps === "1") rows = rows.filter((r) => r.cov.some((c) => eligible.includes(c.key) && c.status === "missing"));
  const gapCount = accounts.filter((a) => roleCoverage(byAccount.get(a.id) ?? []).some((c) => eligible.includes(c.key) && c.status === "missing")).length;
  const q = (p: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="page-enter">
      <PageHeader eyebrow="Research" title="Buying-group coverage" sub="Each company's buying group by role. Grey means nobody found yet (not a no). Decision makers and champions are emailed; influencers and budget owners are shown for context." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={q({ gaps: undefined })} className={`btn btn-sm ${sp.gaps !== "1" ? "btn-primary" : "btn-secondary"}`}>All {accounts.length}</Link>
        <Link href={q({ gaps: "1" })} className={`btn btn-sm ${sp.gaps === "1" ? "btn-primary" : "btn-secondary"}`}>Missing a key role · {gapCount}</Link>
        {(["T1", "T2", "T3"] as const).map((t) => <Link key={t} href={q({ tier: sp.tier === t ? undefined : t })} className={`btn btn-sm ${sp.tier === t ? "btn-primary" : "btn-secondary"}`}>{t}</Link>)}
        <span className="ml-auto flex flex-wrap gap-2">{STATUS_ORDER.map((s) => <span key={s} className="hm-legend"><i style={{ background: STATUS_COLOR[s] }} />{s === "missing" ? "none found" : s}</span>)}</span>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No companies match" /> : (
          <div className="table-wrap">
            <table className="data hm-table">
              <thead><tr><th>Company</th><th title="Stakeholder groups with at least one person: leadership, IT, finance, procurement, operations, data, risk, channel, HR">Groups</th>{ROLES.map((r) => <th key={r.key}>{r.label}{!eligible.includes(r.key) && <span className="muted font-normal"> · context</span>}</th>)}</tr></thead>
              <tbody>
                {rows.map(({ a, cov }) => (
                  <tr key={a.id}>
                    <td className="strong"><Link href={`/accounts/${a.id}?tab=people`} className="hover:underline">{a.name}</Link> <TierBadge tier={a.tier} />{a.outreachPausedUntil && a.outreachPausedUntil > new Date() && <span className="muted text-xs"> · paused</span>}</td>
                    <td className="tnum text-xs" title={groupCover.get(a.id)!.rows.map((r) => `${r.group.label}: ${r.people.map((p) => p.fullName).join(", ") || "nobody"}`).join("\n")}>
                      <b>{groupCover.get(a.id)!.covered}</b>/{groupCover.get(a.id)!.total}{groupCover.get(a.id)!.board.length > 0 && <span className="muted"> · board {groupCover.get(a.id)!.board.length}</span>}
                    </td>
                    {cov.map((c) => (
                      <td key={c.key}>
                        <Link href={`/accounts/${a.id}?tab=people`} className="hm-cell" style={{ ["--c" as string]: STATUS_COLOR[c.status] }} title={c.people.map((p) => `${p.fullName}: ${p.status}`).join("\n") || "Nobody found yet"}>
                          <span className="hm-s">{c.status === "missing" ? "none found" : c.status}</span>
                          {c.people.length > 0 && <span className="hm-p">{c.people.map((p) => p.fullName.split(" ")[0]).join(", ")}</span>}
                        </Link>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
