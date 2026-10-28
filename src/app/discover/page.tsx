import Link from "next/link";
import { ExternalLink, Globe, Plus, Radar, TrendingDown, TrendingUp, X } from "lucide-react";
import { db } from "@/lib/db";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSeller } from "@/lib/scope";
import { industryTrends, type Momentum } from "@/lib/discover/trends";
import { DEFAULT_SCAN_DAYS, MIN_INDEPENDENT_EVENTS, NO_PROSPECTS_MESSAGE, bucketLabel } from "@/lib/discover/scan";
import { sellerFit } from "@/lib/seller/fit";
import { History, RefreshCw } from "lucide-react";
import { ActionButton, ActionForm, SelectAll, SubmitButton } from "@/components/client";
import { Card, Empty, PageHeader, ago, cx } from "@/components/ui";
import { FamilyChip, IntentPill, SectionLabel, StatStrip, type IntentLevel } from "@/components/v2";
import { addSuggestionAction, approveSuggestionsAction, dismissSuggestionAction, scanMarketAction } from "../actions";

export const metadata = { title: "Discover" };

const MOMENTUM: Record<Momentum, { word: string; color: string }> = {
  // Growth is opportunity, so blue, never red (red is for conflicts and blockers only).
  rising: { word: "Rising", color: "var(--info)" },
  steady: { word: "Steady", color: "var(--muted)" },
  cooling: { word: "Cooling", color: "var(--warning)" },
  quiet: { word: "Quiet", color: "var(--text-muted)" },
};
const STATUS = ["new", "watching", "needs_check", "added", "dismissed", "excluded"] as const;
const STATUS_WORD: Record<string, string> = { new: "AI suggested", watching: "One signal so far", needs_check: "Size or country unknown", added: "Approved", dismissed: "Ignored", excluded: "Outside your rule" };

type Source = { url: string; quote: string; at: string; trigger: string; reports?: number; newSinceIgnored?: boolean };
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const ORIGINS = ["market", "lookalike", "website_visitor"] as const;
const ORIGIN_WORD: Record<string, string> = { market: "News & hiring", lookalike: "Similar companies", website_visitor: "Website visitors" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ status?: string; industry?: string; origin?: string; seed?: string }> }) {
  await ensureSellerPacks();
  const sp = await searchParams;
  const status = (STATUS as readonly string[]).includes(sp.status ?? "") ? sp.status! : "new";
  const p = await activeSeller();
  const origin = (ORIGINS as readonly string[]).includes(sp.origin ?? "") ? sp.origin! : undefined;
  const scope = { sellerId: p.id, ...(origin ? { origin } : {}), ...(origin === "lookalike" && sp.seed ? { seed: sp.seed } : {}) };
  const [trends, counts, byOrigin, suggestions, lastScan] = await Promise.all([
    industryTrends(),
    db.prospectSuggestion.groupBy({ by: ["status"], where: scope, _count: true }),
    db.prospectSuggestion.groupBy({ by: ["origin"], where: { sellerId: p.id, status: "new" }, _count: true }),
    db.prospectSuggestion.findMany({ where: { ...scope, status, ...(sp.industry ? { bucket: sp.industry } : {}) }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 60 }),
    db.pipelineEvent.findFirst({ where: { step: "discover.scan" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, reason: true } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const rising = trends.filter((t) => t.momentum === "rising");
  const under = trends.filter((t) => t.underCovered);
  const maxHeat = Math.max(1, ...trends.map((t) => t.heat));
  const link = (q: Record<string, string | undefined>) => `/discover?${new URLSearchParams(Object.entries({ status, industry: sp.industry, origin, seed: origin === "lookalike" ? sp.seed : undefined, ...q }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Discover"
        title="AI suggested prospects"
        sub={<>The AI scans the whole market for buying events that match your Account Brain and suggests companies you don&apos;t hold yet. A company is suggested only if it passes your targeting rule and has at least {MIN_INDEPENDENT_EVENTS} independent signals; many reports of one announcement count once. {lastScan ? `Last scan ${ago(lastScan.createdAt)}.` : "No scan yet."} Runs every {p.discovery?.everyDays ?? DEFAULT_SCAN_DAYS} days. Approving starts research only; emails still need your approval.</>}
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
          <div className="table-wrap">
            <table className="data rd-table">
              <thead><tr><th>Industry</th><th>Events, last 30 days</th><th className="text-right">Before (per month)</th><th className="text-right">Held</th><th>Momentum</th></tr></thead>
              <tbody>
                {trends.filter((t) => t.momentum !== "quiet" || t.internalTriggers || t.hotAccounts).sort((x, y) => y.heat - x.heat).map((t) => {
                  const m = MOMENTUM[t.momentum];
                  const up = t.recent > t.prior;
                  return (
                    <tr key={t.key}>
                      <td>
                        <Link href={link({ industry: t.key, status: "new" })} className="strong">{t.label}</Link>
                        <div className="rd-tags">{t.underCovered && <span className="rd-tag">Under-covered</span>}{t.packTier === "secondary" && <span className="rd-tag">Secondary in your pack</span>}</div>
                        <details className="rd-more">
                          <summary>Why</summary>
                          <p>{t.narrative}</p>
                          {t.evidence.length > 0 && (
                            <ul>
                              {t.evidence.map((e) => (
                                <li key={e.url + e.company}><a href={e.url} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink size={12} /></a> {e.claim} <span className="muted">· {ago(e.at)}</span></li>
                              ))}
                            </ul>
                          )}
                        </details>
                      </td>
                      <td><span className="rd-bar"><i style={{ width: `${Math.round((t.heat / maxHeat) * 100)}%`, background: m.color }} /></span><span className="tnum">{t.recent}</span></td>
                      <td className="text-right tnum">{t.prior.toFixed(t.prior % 1 ? 1 : 0)} <span className={up ? "rd-up" : "rd-down"}>{t.recent === t.prior ? "" : up ? "▲" : "▼"}</span></td>
                      <td className="text-right tnum">{t.held}</td>
                      <td><span className="rd-mom" style={{ color: m.color }}>{t.momentum === "rising" ? <TrendingUp size={13} /> : t.momentum === "cooling" ? <TrendingDown size={13} /> : null} {m.word}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section>
        <SectionLabel count={suggestions.length}>{sp.industry ? `Companies · ${bucketLabel(sp.industry)}` : "Companies to look at"}</SectionLabel>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Link href={link({ origin: undefined, seed: undefined })} className={cx("chip", !origin && "chip-active")} style={!origin ? { ["--c" as string]: "var(--accent-section)" } : undefined}>All sources</Link>
          {ORIGINS.map((o) => (
            <Link key={o} href={link({ origin: o, seed: undefined })} className={cx("chip", origin === o && "chip-active")} style={origin === o ? { ["--c" as string]: "var(--accent-section)" } : undefined}>
              {ORIGIN_WORD[o]} <span className="tnum">{byOrigin.find((b) => b.origin === o)?._count ?? 0}</span>
            </Link>
          ))}
          {origin === "lookalike" && sp.seed && <Link href={link({ seed: undefined })} className="chip"><X size={12} /> like {sp.seed}</Link>}
          <Link href="/import" className="ml-auto text-xs font-semibold" style={{ color: "var(--accent-indigo)" }}>Find more →</Link>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {STATUS.map((s) => (
            <Link key={s} href={link({ status: s })} className={cx("chip", s === status && "chip-active")} style={s === status ? { ["--c" as string]: "var(--accent-section)" } : undefined}>
              {STATUS_WORD[s]} <span className="tnum">{count(s)}</span>
            </Link>
          ))}
          {sp.industry && <Link href={link({ industry: undefined })} className="chip"><X size={12} /> {bucketLabel(sp.industry)}</Link>}
        </div>
        {suggestions.length === 0 ? (
          <Card><Empty icon={<Globe size={22} />} title={status === "new" ? NO_PROSPECTS_MESSAGE : `Nothing here: ${STATUS_WORD[status].toLowerCase()}`} sub={status === "new" ? "The next scan runs on its own. You can also scan now, find companies similar to one website on Import, or connect Apollo website visitors." : undefined} /></Card>
        ) : (
          <ActionForm action={approveSuggestionsAction}>
          {status === "new" && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold"><SelectAll name="ids" label="Select all" /> Select all</label>
              <SubmitButton className="btn btn-primary btn-sm">Approve selected — start research</SubmitButton>
              <span className="muted text-xs">Nothing is researched or contacted until you approve it.</span>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {suggestions.map((s) => {
              const sources = (s.sources as Source[]) ?? [];
              const fit = sellerFit({ industry: s.industry, employees: s.employees, country: s.country }, p).fit;
              const fresh = sources.filter((x) => x.newSinceIgnored);
              return (
                <article key={s.id} className="glass-card-static card-pad min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {s.status === "new" && <input type="checkbox" name="ids" value={s.id} className="mt-1" aria-label={`Select ${s.name}`} />}
                      <div className="min-w-0">
                      <h3 className="truncate font-semibold" style={{ color: "var(--text-primary)" }}>{s.name} <span className="chip ml-1 align-middle">{ORIGIN_WORD[s.origin] ?? s.origin}</span>
                        {s.version > 1 && <span className="ds-mark" title={`Revised ${s.version - 1} time${s.version > 2 ? "s" : ""} with stronger evidence`}><RefreshCw size={12} /></span>}
                        {s.resurfacedAt && <span className="ds-mark warn" title="Previously ignored"><History size={12} /></span>}
                      </h3>
                      <div className="muted text-xs">
                        {[s.domain, s.industry, s.country, s.employees != null ? `${s.employees.toLocaleString()} employees` : "size unknown"].filter(Boolean).join(" · ")}
                      </div>
                      </div>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1"><IntentPill level={s.level as IntentLevel} score={s.score} />{fit != null && <span className="muted text-xs tnum">Fit {fit}</span>}</span>
                  </div>
                  {s.resurfacedAt && (
                    <details className="ds-prev mt-3">
                      <summary><History size={13} /> Previously ignored{s.decidedAt ? ` on ${day(s.decidedAt)}` : ""}: back on new evidence</summary>
                      <ul className="mt-2 space-y-1 text-xs">
                        {fresh.map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer" className="underline">{(() => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return "source"; } })()}</a> · {day(new Date(x.at))} · &ldquo;{x.quote.slice(0, 140)}&rdquo;</li>)}
                      </ul>
                    </details>
                  )}
                  {s.origin === "market" && <p className="mt-2 text-xs muted">{sources.length} independent signal{sources.length === 1 ? "" : "s"}{sources.some((x) => (x.reports ?? 1) > 1) ? ` · ${sources.reduce((n, x) => n + (x.reports ?? 1), 0)} reports grouped` : ""}</p>}
                  <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}><span className="font-semibold" style={{ color: "var(--text-primary)" }}>{s.origin === "lookalike" ? "Why: " : "Why now: "}</span>{s.whyNow}</p>
                  {s.families.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{s.families.map((f) => <FamilyChip key={f} family={f} />)}</div>}
                  {s.reason && <p className="mt-2 text-xs" style={{ color: "var(--intent-hot)" }}>{s.reason}</p>}
                  {sources.length > 0 && (
                    <details className="more mt-2">
                      <summary>{sources.length} source{sources.length > 1 ? "s" : ""}</summary>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {sources.map((x) => (
                          <li key={x.url} className="flex min-w-0 items-start gap-2">
                            <a href={x.url} target="_blank" rel="noreferrer" className="shrink-0 pt-0.5" aria-label="Open source"><ExternalLink size={14} /></a>
                            <span className="min-w-0 break-words">&ldquo;{x.quote}&rdquo; <span className="muted text-xs">· {day(new Date(x.at))}{(x.reports ?? 1) > 1 ? ` · ${x.reports} reports of this event` : ""}</span></span>
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
                        {(s.status === "new" || s.status === "dismissed") && <ActionButton action={addSuggestionAction.bind(null, s.id)} className="btn btn-primary"><Plus size={15} /> Approve &amp; start research</ActionButton>}
                        {s.status !== "dismissed" && s.status !== "excluded" && <ActionButton action={dismissSuggestionAction.bind(null, s.id)} className="btn btn-secondary">Ignore</ActionButton>}
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
