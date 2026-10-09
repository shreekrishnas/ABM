import Link from "next/link";
import { Play, Timer } from "lucide-react";
import { db } from "@/lib/db";
import { CONFIG, STAGES } from "@/lib/config";
import { CAT_COLOR, STAGE_DOCS } from "@/lib/stage-docs";
import { ActionButton } from "@/components/client";
import { Badge, Card, Empty, Kpi, PageHeader, ago, cx } from "@/components/ui";
import { runAllAction, tickAction } from "../actions";
import { QueuePanel } from "@/components/queue-panel";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const sel = Math.min(13, Math.max(1, Number((await searchParams).s ?? 10) || 10));
  const stage = STAGES[sel - 1];
  const doc = STAGE_DOCS[sel];

  const [atStage, blocksByStage, stepStats, recentBlocks, readiness, loops, watch] = await Promise.all([
    db.account.groupBy({ by: ["pipelineStage", "pipelineStatus"], where: { mergedIntoId: null }, _count: true }),
    db.pipelineEvent.groupBy({ by: ["stage"], where: { outcome: "block" }, _count: true }),
    db.pipelineEvent.groupBy({ by: ["step", "outcome"], where: { stage: sel }, _count: true }),
    db.pipelineEvent.findMany({ where: { stage: sel, outcome: { in: ["block", "error"] } }, orderBy: { createdAt: "desc" }, take: 12, include: { account: true } }),
    db.contact.groupBy({ by: ["readiness"], where: { readiness: { not: null } }, _count: true }),
    db.account.aggregate({ _count: { _all: true }, where: { followupUsed: true } }),
    db.watchlistEntry.count({ where: { status: "waiting" } }),
  ]);

  const reached = (n: number) => atStage.filter((g) => g.pipelineStage >= n).reduce((a, g) => a + g._count, 0);
  const stuck = (n: number) => atStage.filter((g) => g.pipelineStage === n - 1 && g.pipelineStatus === "blocked").reduce((a, g) => a + g._count, 0);
  const blocks = (n: number) => blocksByStage.find((b) => b.stage === n)?._count ?? 0;

  const steps = new Map<string, { pass: number; block: number; info: number; error: number }>();
  for (const s of stepStats) {
    const e = steps.get(s.step) ?? { pass: 0, block: 0, info: 0, error: 0 };
    e[s.outcome] += s._count;
    steps.set(s.step, e);
  }
  const R = (k: string) => readiness.find((r) => r.readiness === k)?._count ?? 0;

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Verify before drafting"
        title="Intelligence pipeline"
        sub="Thirteen stages take raw account data to evidence-based outreach and a sales handoff. Fit now runs before identity checks, so excluded accounts spend nothing."
        actions={
          <>
            <ActionButton action={tickAction} className="btn btn-secondary"><Timer size={15} /> Run scheduler</ActionButton>
            <ActionButton action={runAllAction} className="btn btn-brand"><Play size={15} /> Process new companies</ActionButton>
          </>
        }
      />

      <QueuePanel className="mb-5" />

      <Card>
        <div className="table-wrap pb-2">
          <nav className="transit" aria-label="Pipeline stages">
            {STAGES.map((s) => (
              <Link key={s.n} href={`/pipeline?s=${s.n}`} scroll={false} className={cx("stn", s.n === sel && "on")} style={{ ["--c" as string]: CAT_COLOR[s.cat] }} aria-current={s.n === sel ? "step" : undefined}>
                <div className="node" />
                <div className="muted text-[0.7rem] tnum">{s.n}</div>
                <div className="text-[0.78rem] font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>{s.name}</div>
                <div className="mt-1 flex flex-wrap justify-center gap-1">
                  <span className="badge" style={{ background: "var(--surface-track)", color: "var(--text-secondary)" }} title="Accounts that completed this stage">{reached(s.n)}</span>
                  {blocks(s.n) > 0 && <span className="badge" style={{ background: "rgba(245,158,11,0.12)", color: "#B45309" }} title="Gate blocks logged">{blocks(s.n)}</span>}
                </div>
              </Link>
            ))}
          </nav>
        </div>
        <div className="muted mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span><b className="secondary">Loop 1</b> 10 → 6: weak evidence gets one targeted re-research pass ({loops._count._all} used)</span>
          <span><b className="secondary">Loop 2</b> 7 → 6: a contradiction reopens its question once</span>
          <span><b className="secondary">Refresh</b> watchlist / intent surge → 5 ({watch} waiting)</span>
          <span className="ml-auto flex gap-3">{Object.entries(CAT_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{k}</span>)}</span>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <section className="glass-card-static card-pad xl:col-span-2" style={{ borderTop: `4px solid ${CAT_COLOR[stage.cat]}` }}>
          <div className="text-xs font-semibold" style={{ color: CAT_COLOR[stage.cat] }}>{stage.cat.charAt(0).toUpperCase() + stage.cat.slice(1)} · stage {stage.n} of 13</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{stage.name}</h2>
          <p className="secondary mt-2 text-sm">{doc.purpose}</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><div className="micro">Starts when</div><code className="mono secondary">{doc.trigger}</code></div>
            <div><div className="micro">Produces</div><span className="secondary">{doc.output}</span></div>
          </div>
          <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ background: "var(--surface-card-header)" }}><div className="micro mb-0.5">Control rule</div><span className="secondary">{doc.rule}</span></div>

          <div className="micro mb-2 mt-6">Steps (live counts)</div>
          {steps.size === 0 ? <span className="muted text-sm">No events recorded for this stage yet.</span> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Step</th><th>Pass</th><th>Block</th><th>Info</th><th>Error</th></tr></thead>
                <tbody>
                  {[...steps.entries()].map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono strong">{k.split(".")[1] ?? k}</td>
                      <td className="tnum" style={{ color: v.pass ? "#059669" : undefined }}>{v.pass}</td>
                      <td className="tnum" style={{ color: v.block ? "#B45309" : undefined }}>{v.block}</td>
                      <td className="tnum">{v.info}</td>
                      <td className="tnum" style={{ color: v.error ? "#DC2626" : undefined }}>{v.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid content-start gap-5">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Completed" value={reached(sel)} meta="accounts past this stage" accent={CAT_COLOR[stage.cat]} />
            <Kpi label="Stopped here" value={stuck(sel)} meta="currently blocked" accent="#F59E0B" />
          </div>
          <Card title="Recent blocks" sub="Every stop has a reason and a destination">
            {recentBlocks.length === 0 ? <Empty title="No blocks at this stage" /> : (
              <ul className="grid gap-2">
                {recentBlocks.map((b) => (
                  <li key={b.id} className="text-xs">
                    <div className="flex justify-between gap-2"><Link href={`/accounts/${b.accountId}?tab=pipeline`} className="font-semibold hover:underline" style={{ color: "var(--text-primary)" }}>{b.account?.name ?? "—"}</Link><span className="muted">{ago(b.createdAt)}</span></div>
                    <div className="secondary">{b.reason}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Readiness outcomes" sub="Stage 10 gives every selected person one outcome; first matching rule wins">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>#</th><th>Outcome</th><th>When</th><th>People</th></tr></thead>
              <tbody>
                {[
                  ["disqualified", "Acquired, bankrupt, signed a competitor, or suppressed"],
                  ["watch", `Layoffs/freeze in ${CONFIG.readiness.negativeWatchDays}d, or evidence still weak after follow-up`],
                  ["targeted_re_research", "Evidence weak and follow-up unused"],
                  ["human_review", "Identity not verified/probable, no lawful basis, or not a decision maker/champion"],
                  ["ready", `Identity ok, DM or champion, ${CONFIG.readiness.minVerifiedTriggers} verified or ${CONFIG.readiness.minUsableTriggers} usable triggers in ${CONFIG.readiness.triggerWindowDays}d`],
                ].map(([k, when], i) => (
                  <tr key={k}><td className="tnum">{i + 1}</td><td className="mono strong">{k}</td><td>{when}</td><td className="tnum font-semibold" style={{ color: "var(--text-primary)" }}>{R(k)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Field status" sub="Every important field and fact carries one of six statuses">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[
              ["verified", "#059669", "Official source, two independent sources, provider or mailbox check."],
              ["probable", "#0D9488", "One credible source and nothing against it. Usable in a draft."],
              ["conflicting", "#DC2626", "Sources disagree. One focused re-check, then a person."],
              ["stale", "#B45309", `Older than its limit: email ${CONFIG.freshnessDays.email}d, title ${CONFIG.freshnessDays.title}d, triggers ${CONFIG.freshnessDays.trigger}d.`],
              ["invalid", "#991B1B", "Proven wrong: malformed, hard bounce."],
              ["unknown", "#64748B", "Not yet checked, or nothing found."],
            ].map(([k, c, d]) => (
              <div key={k} className="rounded-xl px-3.5 py-3" style={{ background: "var(--surface-card-header)" }}>
                <Badge color={c} dot>{k}</Badge>
                <p className="secondary mt-1.5 text-xs leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
