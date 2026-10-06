import { ArrowRight, BrainCircuit, CheckCircle2, CircleSlash, Lightbulb, PiggyBank, Search, ShieldCheck, Target, TrendingDown, TrendingUp } from "lucide-react";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { seller } from "@/lib/seller";
import { serviceStatus } from "@/lib/adapters";
import { computeStats, latestInsight } from "@/lib/brain/insights";
import type { Rate } from "@/lib/brain/types";
import { ActionButton } from "@/components/client";
import { Badge, Card, Empty, Kpi, PageHeader, ago } from "@/components/ui";
import { generateInsightsAction } from "../actions";

export const metadata = { title: "AI Brain" };
export const maxDuration = 120;

const STEPS = [
  { t: "Plan", d: "Picks the questions that matter for this company, writes the query and chooses the engine" },
  { t: "Search once", d: "One engine per question; a repeat within 7 days is served from cache" },
  { t: "Verify", d: "A second engine only for a single-source trigger, with a claim-specific query" },
  { t: "Connect", d: "Ties facts to pain points and to the Manch use case that solves them" },
  { t: "Angle per person", d: "Each role gets its own pain; colleagues never get the same email" },
  { t: "Write + check", d: "Every claim cites a fact, then a second pass checks the fact really says it" },
  { t: "Human review", d: "Nothing goes out unchecked; edits and rejections are recorded" },
  { t: "Learn", d: "Weekly: what works, what doesn't, which engine finds what — fed back into the next plans" },
];

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function RateTable({ rows, unit, minSample }: { rows: Rate[]; unit: string; minSample: number }) {
  if (!rows.length) return <div className="card-pad"><Empty title="No data yet" sub="Fills in as emails go out and replies come back." /></div>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>Group</th><th>{unit}</th><th>Positive</th><th>Rate</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="strong">{r.label.replace(/_/g, " ")}</td>
              <td className="tnum">{r.n}</td>
              <td className="tnum">{r.hits}</td>
              <td className="tnum">{r.rate == null ? "—" : <span className="font-semibold" style={{ color: r.n < minSample ? "var(--text-muted)" : "var(--text-primary)" }} title={r.n < minSample ? `Fewer than ${minSample} — not a finding yet` : undefined}>{Math.round(r.rate * 100)}%{r.n < minSample ? "*" : ""}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function BrainPage() {
  const [stats, insight, checkedDrafts] = await Promise.all([
    computeStats(),
    latestInsight(),
    db.draft.findMany({ where: { claimCheck: { not: Prisma.DbNull } }, select: { claimCheck: true }, take: 2000, orderBy: { createdAt: "desc" } }),
  ]);
  const sp = seller();
  const svc = serviceStatus();
  const llm = svc.find((s) => s.key === "llm")!;
  const research = svc.find((s) => s.key === "research")!;

  const claims = checkedDrafts.flatMap((d) => (Array.isArray(d.claimCheck) ? (d.claimCheck as { supported: boolean }[]) : []));
  const supported = claims.filter((c) => c.supported).length;
  const paid = stats.research.reduce((s, r) => s + r.searches, 0);
  const cached = stats.research.reduce((s, r) => s + r.cached, 0);
  const kept = stats.research.reduce((s, r) => s + r.kept, 0);
  const spent = stats.research.reduce((s, r) => s + r.costUsd, 0);
  const rv = stats.review;

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Intelligence"
        title="AI Brain"
        sub={<>One brain runs the whole flow for <b>{sp.name}</b>: it plans the research, tells each tool what to look for, connects the findings into pain points, writes a different angle for every person, checks its own claims and learns from what happens.</>}
        actions={<ActionButton action={generateInsightsAction} className="btn btn-brand"><Lightbulb size={15} /> Summarise what&apos;s working</ActionButton>}
      />

      <div className="glass-card-static card-pad mb-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <BrainCircuit size={16} style={{ color: "#7C3AED" }} />
          <span className="secondary">Model:</span> <Badge color={llm.mode === "live" ? "#059669" : "#64748B"}>{llm.mode === "live" ? llm.via.replace("OpenRouter · ", "") : "sample brain (add OPENROUTER_API_KEY)"}</Badge>
          <span className="secondary ml-2">Search:</span> <Badge color={research.mode === "live" ? "#059669" : "#64748B"}>{research.mode === "live" ? research.via : "sample data (add Exa / Tavily / SerpAPI keys)"}</Badge>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t} className="rounded-xl px-3 py-2.5" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--text-primary)" }}><span className="mono muted text-xs">{i + 1}</span>{s.t}{i < STEPS.length - 1 && <ArrowRight size={12} className="muted ml-auto hidden xl:block" />}</div>
              <div className="muted mt-0.5 text-[0.72rem] leading-snug">{s.d}</div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Claims supported" value={pct(supported, claims.length)} accent="#059669" icon={<ShieldCheck size={16} />} meta={`${claims.length} claims checked · ${rv.claimsUnsupported} caught & rewritten`} />
        <Kpi label="Approved as written" value={pct(rv.approvedAsIs, rv.reviewed)} accent="#4F46E5" icon={<CheckCircle2 size={16} />} meta={`${rv.reviewed} reviewed · ${rv.edited} edited · ${rv.rejected} rejected`} />
        <Kpi label="Fact precision" value={stats.facts.total ? pct(stats.facts.total - stats.facts.flagged, stats.facts.total) : "—"} accent="#0D9488" icon={<Target size={16} />} meta={`${stats.facts.flagged} of ${stats.facts.total} facts marked wrong`} />
        <Kpi label="Facts per search" value={paid ? (kept / paid).toFixed(2) : "—"} accent="#0EA5E9" icon={<Search size={16} />} meta={`${kept} facts from ${paid} paid searches`} />
        <Kpi label="Search spend" value={`$${spent.toFixed(2)}`} accent="#F59E0B" meta="Last 120 days, estimated" />
        <Kpi label="Saved by cache" value={`$${stats.creditsSavedUsd.toFixed(2)}`} accent="#10B981" icon={<PiggyBank size={16} />} meta={`${cached} repeat searches avoided`} />
      </div>
      <p className="muted -mt-2 mb-5 text-xs">Accuracy target 98%: watch <b>Claims supported</b>, <b>Approved as written</b> and <b>Fact precision</b>. Mark wrong facts on any company page — the brain stops using them and counts them against the engine that found them.</p>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={<span className="inline-flex items-center gap-2"><Lightbulb size={16} style={{ color: "#F59E0B" }} /> What&apos;s working, what&apos;s not</span>} sub={insight ? `${insight.model === "mock" ? "Sample brain" : insight.model === "rules" ? "Rule-based" : insight.model} · ${ago(insight.createdAt)} · refreshed weekly` : "No summary yet"}>
          {!insight ? <Empty icon={<Lightbulb size={20} />} title="No summary yet" sub="Click “Summarise what's working”. It also runs weekly on its own." /> : (
            <div className="grid gap-4">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{insight.headline}</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="micro mb-2 flex items-center gap-1.5" style={{ color: "#059669" }}><TrendingUp size={13} /> Working</div>
                  {insight.working.length ? <ul className="grid gap-2 text-sm">{insight.working.map((w, i) => <li key={i}><span className="secondary">{w.text}</span><div className="mono muted text-[0.7rem]">{w.evidence}</div></li>)}</ul> : <span className="muted text-xs">Not enough data yet</span>}
                </div>
                <div>
                  <div className="micro mb-2 flex items-center gap-1.5" style={{ color: "#DC2626" }}><TrendingDown size={13} /> Not working</div>
                  {insight.notWorking.length ? <ul className="grid gap-2 text-sm">{insight.notWorking.map((w, i) => <li key={i}><span className="secondary">{w.text}</span><div className="mono muted text-[0.7rem]">{w.evidence}</div></li>)}</ul> : <span className="muted text-xs">Nothing flagged</span>}
                </div>
              </div>
              <div>
                <div className="micro mb-2">Recommendations</div>
                <ul className="grid gap-1.5 text-sm">{insight.recommendations.map((r, i) => <li key={i} className="flex gap-2"><Badge color="#7C3AED">{r.area}</Badge><span className="secondary">{r.text}</span></li>)}</ul>
                <p className="muted mt-2 text-xs">Engine routing is applied automatically once an engine has {CONFIG.brain.minSample}+ searches for a question. Messaging learnings go to the draft writer as style advice. Targeting changes (ICP weights) wait for you.</p>
              </div>
            </div>
          )}
        </Card>

        <Card title="Fit score vs results" sub="Of companies emailed: share that replied positively or opened a deal" pad={false}>
          <RateTable rows={stats.fit} unit="Emailed" minSample={stats.minSample} />
        </Card>

        <Card className="xl:col-span-2" title={<span className="inline-flex items-center gap-2"><Search size={16} /> Research efficiency by engine</span>} sub="Which tool finds usable facts for which question — routing follows the best one" pad={false}>
          {stats.research.length === 0 ? <div className="card-pad"><Empty title="No searches yet" /></div> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Engine</th><th>Question</th><th>Paid searches</th><th>From cache</th><th>Facts kept</th><th>Facts / search</th><th>Cost</th></tr></thead>
                <tbody>
                  {stats.research.sort((a, b) => a.key.localeCompare(b.key) || (b.yield ?? 0) - (a.yield ?? 0)).map((r) => (
                    <tr key={`${r.engine}-${r.key}`}>
                      <td><Badge color="#4F46E5">{r.engine}</Badge></td>
                      <td className="strong">{r.key.replace(/_/g, " ")}</td>
                      <td className="tnum">{r.searches}</td>
                      <td className="tnum">{r.cached}</td>
                      <td className="tnum">{r.kept}</td>
                      <td className="tnum font-semibold" style={{ color: r.yield === 0 ? "#DC2626" : "var(--text-primary)" }}>{r.yield == null ? "—" : r.yield.toFixed(2)}{r.searches >= stats.minSample && r.kept === 0 && <CircleSlash size={12} className="ml-1 inline" />}</td>
                      <td className="tnum muted">${r.costUsd.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Fact precision by engine" sub="Share of facts people marked wrong" pad={false}>
          {stats.facts.byEngine.length === 0 ? <div className="card-pad"><Empty title="No facts yet" /></div> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Engine</th><th>Facts</th><th>Marked wrong</th><th>Precision</th></tr></thead>
                <tbody>{stats.facts.byEngine.map((r) => <tr key={r.label}><td className="strong">{r.label}</td><td className="tnum">{r.n}</td><td className="tnum">{r.hits}</td><td className="tnum font-semibold">{pct(r.n - r.hits, r.n)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Positive replies by use case" pad={false}><RateTable rows={stats.messaging.byUseCase} unit="Sent" minSample={stats.minSample} /></Card>
        <Card title="Positive replies by buying role" pad={false}><RateTable rows={stats.messaging.byRole} unit="Sent" minSample={stats.minSample} /></Card>
        <Card title="Positive replies by trigger" pad={false}><RateTable rows={stats.messaging.byTrigger.map((r) => ({ ...r, label: sp.triggers.find((t) => t.key === r.label)?.label ?? r.label }))} unit="Sent" minSample={stats.minSample} /></Card>
      </div>
      <p className="muted mt-3 text-xs">* fewer than {stats.minSample} examples — shown, but the brain won&apos;t treat it as a finding.</p>
    </div>
  );
}
