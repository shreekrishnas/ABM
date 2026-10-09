import Link from "next/link";
import { ExternalLink, Globe, Plus, Radar, TrendingDown, TrendingUp, X } from "lucide-react";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { industryTrends, type Momentum } from "@/lib/discover/trends";
import { bucketLabel } from "@/lib/discover/scan";
import { ActionButton } from "@/components/client";
import { Card, Empty, PageHeader, ago, cx } from "@/components/ui";
import { FamilyChip, IntentPill, SectionLabel, StatStrip, type IntentLevel } from "@/components/v2";
import { addSuggestionAction, dismissSuggestionAction, scanMarketAction } from "../actions";

export const metadata = { title: "Discover" };

const MOMENTUM: Record<Momentum, { word: string; color: string }> = {
  rising: { word: "Rising", color: "var(--intent-hot)" },
  steady: { word: "Steady", color: "var(--intent-warm)" },
  cooling: { word: "Cooling", color: "var(--intent-cold)" },
  quiet: { word: "Quiet", color: "var(--text-muted)" },
};
const STATUS = ["new", "added", "dismissed", "excluded"] as const;
const STATUS_WORD: Record<string, string> = { new: "Suggested", added: "Added", dismissed: "Dismissed", excluded: "Outside your rule" };

type Source = { url: string; quote: string; at: string; trigger: string };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ status?: string; industry?: string }> }) {
  const sp = await searchParams;
  const status = (STATUS as readonly string[]).includes(sp.status ?? "") ? sp.status! : "new";
  const p = seller();
  const [trends, counts, suggestions, lastScan] = await Promise.all([
    industryTrends(),
    db.prospectSuggestion.groupBy({ by: ["status"], where: { sellerId: p.id }, _count: true }),
    db.prospectSuggestion.findMany({ where: { sellerId: p.id, status, ...(sp.industry ? { bucket: sp.industry } : {}) }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 60 }),
    db.marketEvent.findFirst({ where: { sellerId: p.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const rising = trends.filter((t) => t.momentum === "rising");
  const under = trends.filter((t) => t.underCovered);
  const maxHeat = Math.max(1, ...trends.map((t) => t.heat));
  const link = (q: Record<string, string | undefined>) => `/discover?${new URLSearchParams(Object.entries({ status, industry: sp.industry, ...q }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Discover"
        title="New companies and rising industries"
        sub={<>The brain scans the news for buying events in your market, suggests companies you don&apos;t hold yet, and shows which industries are heating up. {lastScan ? `Last scan ${ago(lastScan.createdAt)}.` : "No scan yet."} It also runs on its own once a week.</>}
        actions={<ActionButton action={scanMarketAction} className="btn btn-primary"><Globe size={16} /> Scan the market now</ActionButton>}
      />

      <StatStrip
        items={[
          { label: "Suggested companies", value: count("new") },
          { label: "Rising industries", value: rising.length, meta: rising.slice(0, 2).map((t) => t.label.split(/[ ,&/]/)[0]).join(", ") || undefined },
          { label: "Under-covered", value: under.length, meta: under.length ? "rising, few companies held" : undefined },
          { label: "Added from Discover", value: count("added") },
        ]}
      />

      <Card title={<span className="inline-flex items-center gap-2"><Radar size={18} /> Industry radar</span>} sub="Buying events in the last 30 days against the 60 days before, plus what's happening in your own accounts">
        {trends.every((t) => t.momentum === "quiet" && !t.internalTriggers) ? (
          <Empty icon={<Radar size={22} />} title="No market data yet" sub="Run a scan to see which industries are heating up." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--glass-border)" }}>
            {trends.filter((t) => t.momentum !== "quiet" || t.internalTriggers || t.hotAccounts).map((t) => {
              const m = MOMENTUM[t.momentum];
              return (
                <li key={t.key} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Link href={link({ industry: t.key, status: "new" })} className="min-w-0 font-semibold" style={{ color: "var(--text-primary)" }}>{t.label}</Link>
                    <span className="chip" style={{ ["--c" as string]: m.color }}>
                      {t.momentum === "rising" ? <TrendingUp size={13} /> : t.momentum === "cooling" ? <TrendingDown size={13} /> : <span className="dot" />} {m.word}
                    </span>
                    {t.underCovered && <span className="chip" style={{ ["--c" as string]: "var(--intent-hot)" }}>Under-covered</span>}
                    {t.packTier === "secondary" && <span className="chip">Secondary in your pack</span>}
                    <span className="muted ml-auto text-xs tnum">{t.recent} in 30d · {t.prior.toFixed(t.prior % 1 ? 1 : 0)}/mo before · {t.held} held</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--glass-border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.round((t.heat / maxHeat) * 100)}%`, background: m.color }} />
                  </div>
                  <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{t.narrative}</p>
                  {t.evidence.length > 0 && (
                    <details className="more mt-1">
                      <summary>Evidence ({t.evidence.length})</summary>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {t.evidence.map((e) => (
                          <li key={e.url + e.company} className="flex min-w-0 items-start gap-2">
                            <a href={e.url} target="_blank" rel="noreferrer" className="shrink-0 pt-0.5" aria-label="Open source"><ExternalLink size={14} /></a>
                            <span className="min-w-0 break-words">{e.claim} <span className="muted text-xs">· {ago(e.at)}</span></span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <section>
        <SectionLabel count={suggestions.length}>{sp.industry ? `Companies · ${bucketLabel(sp.industry)}` : "Companies to look at"}</SectionLabel>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {STATUS.map((s) => (
            <Link key={s} href={link({ status: s })} className={cx("chip", s === status && "chip-active")} style={s === status ? { ["--c" as string]: "var(--accent-section)" } : undefined}>
              {STATUS_WORD[s]} <span className="tnum">{count(s)}</span>
            </Link>
          ))}
          {sp.industry && <Link href={link({ industry: undefined })} className="chip"><X size={12} /> {bucketLabel(sp.industry)}</Link>}
        </div>
        {suggestions.length === 0 ? (
          <Card><Empty icon={<Globe size={22} />} title={status === "new" ? "No suggestions yet" : `Nothing ${STATUS_WORD[status].toLowerCase()}`} sub={status === "new" ? "Run a scan: companies with fresh buying events that you don't hold yet show up here." : undefined} /></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {suggestions.map((s) => {
              const sources = (s.sources as Source[]) ?? [];
              return (
                <article key={s.id} className="glass-card-static card-pad min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold" style={{ color: "var(--text-primary)" }}>{s.name}</h3>
                      <div className="muted text-xs">
                        {[s.industry, s.country, s.employees != null ? `${s.employees.toLocaleString("en-IN")} employees` : "size unknown"].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <IntentPill level={s.level as IntentLevel} score={s.score} />
                  </div>
                  <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Why now: </span>{s.whyNow}</p>
                  {s.families.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{s.families.map((f) => <FamilyChip key={f} family={f} />)}</div>}
                  {s.reason && <p className="mt-2 text-xs" style={{ color: "var(--intent-hot)" }}>{s.reason}</p>}
                  {sources.length > 0 && (
                    <details className="more mt-2">
                      <summary>{sources.length} source{sources.length > 1 ? "s" : ""}</summary>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {sources.map((x) => (
                          <li key={x.url} className="flex min-w-0 items-start gap-2">
                            <a href={x.url} target="_blank" rel="noreferrer" className="shrink-0 pt-0.5" aria-label="Open source"><ExternalLink size={14} /></a>
                            <span className="min-w-0 break-words">&ldquo;{x.quote}&rdquo; <span className="muted text-xs">· {ago(new Date(x.at))}</span></span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {s.status === "added" && s.accountId ? (
                      <Link href={`/accounts/${s.accountId}`} className="btn btn-secondary">Open company</Link>
                    ) : s.status !== "added" ? (
                      <>
                        {s.status !== "excluded" && <ActionButton action={addSuggestionAction.bind(null, s.id)} className="btn btn-primary"><Plus size={15} /> Add to companies</ActionButton>}
                        {s.status !== "dismissed" && <ActionButton action={dismissSuggestionAction.bind(null, s.id)} className="btn btn-secondary">Dismiss</ActionButton>}
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
