import { BrainCircuit, Compass, FlaskConical, Search, ShieldAlert, Target, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { latestBrief } from "@/lib/brain/strategist";
import type { TwinSnapshot } from "@/lib/pipeline/stages/research";
import { ActionButton } from "@/components/client";
import { Badge, Card, Empty, ago } from "@/components/ui";
import { rethinkAccountAction } from "../../actions";

export const VERDICT_COLOR = { strong: "#059669", moderate: "#B45309", weak: "#64748B" } as const;
const CONF_COLOR = { high: "#059669", medium: "#B45309", low: "#64748B" } as const;

export async function BrainTab({ accountId, twin }: { accountId: string; twin?: TwinSnapshot }) {
  const [brief, plan, searches] = await Promise.all([
    latestBrief(accountId),
    db.researchPlan.findFirst({ where: { accountId }, orderBy: { createdAt: "desc" } }),
    db.researchQuery.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const sp = seller();
  const factById = new Map((twin?.facts ?? []).map((f) => [f.id, f]));
  const useCaseName = (k: string) => sp.useCases.find((u) => u.key === k)?.name ?? k.replace(/_/g, " ");
  const spent = searches.reduce((s, q) => s + q.costMicros, 0) / 1e6;
  const cachedHits = searches.filter((q) => q.cached).length;

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="grid content-start gap-5 xl:col-span-2">
        {!brief ? (
          <Card><Empty icon={<BrainCircuit size={20} />} title="No brain brief yet" sub="The brain writes one after research finds usable facts." /></Card>
        ) : (
          <>
            <Card
              title={<span className="inline-flex items-center gap-2"><BrainCircuit size={17} style={{ color: "#7C3AED" }} /> Brain verdict</span>}
              sub={`v${brief.version} · ${brief.model === "mock" ? "sample brain" : brief.model === "rules" ? "rule-based fallback" : brief.model}`}
              action={<ActionButton action={rethinkAccountAction.bind(null, accountId)} className="btn btn-secondary btn-sm" title="Re-check facts, rebuild the brief, then readiness and drafts">Re-think</ActionButton>}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={VERDICT_COLOR[brief.verdict]} dot>{brief.verdict} fit for {sp.name}</Badge>
              </div>
              <p className="secondary mt-2 text-sm">{brief.verdictWhy}</p>
              {brief.whyNow && (
                <div className="mt-3 rounded-xl px-3.5 py-3 text-sm" style={{ background: "var(--surface-card-header)" }}>
                  <div className="micro mb-1">Why now</div>
                  <span style={{ color: "var(--text-primary)" }}>{brief.whyNow.text}</span>
                  <FactRefs ids={brief.whyNow.factIds} facts={factById} />
                </div>
              )}
              <div className="mt-3 flex items-start gap-2 text-sm"><Compass size={16} className="mt-0.5 shrink-0" style={{ color: "#4F46E5" }} /><span><b style={{ color: "var(--text-primary)" }}>Next best action:</b> <span className="secondary">{brief.nextBestAction}</span></span></div>
            </Card>

            <Card title="Pain points → what Manch solves" sub="Each pain is an inference resting on the cited facts. Drafts phrase it as a question, never as a fact.">
              {brief.painPoints.length === 0 ? <span className="muted text-xs">No pain point could be tied to a fact yet.</span> : (
                <ol className="grid gap-3">
                  {brief.painPoints.map((p, i) => (
                    <li key={i} className="rounded-xl px-3.5 py-3" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{i + 1}. {p.pain}</span>
                        <Badge color={CONF_COLOR[p.confidence]}>{p.confidence}</Badge>
                      </div>
                      <div className="mt-1.5 text-xs secondary"><Target size={12} className="mr-1 inline" style={{ color: "#0D9488" }} /><b>{useCaseName(p.useCase)}</b> — {p.capability}</div>
                      <FactRefs ids={p.factIds} facts={factById} />
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Angle per person" sub="Each buying role gets its own pain point; colleagues in the same role rotate, so nobody at the company receives the same email.">
              {brief.personaAngles.length === 0 ? <span className="muted text-xs">No angles yet.</span> : (
                <ul className="grid gap-2.5">
                  {brief.personaAngles.map((a, i) => (
                    <li key={i} className="flex gap-2.5 text-sm">
                      <UserRound size={16} className="mt-0.5 shrink-0" style={{ color: "#4F46E5" }} />
                      <span><b style={{ color: "var(--text-primary)" }}>{a.role.replace("_", " ")}</b> <span className="secondary">— {a.angle}</span> <span className="muted text-xs">· pain {a.painIndex + 1}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}

        <Card title={<span className="inline-flex items-center gap-2"><Search size={16} /> Research log</span>} sub={`Every search the brain ran · $${spent.toFixed(3)} spent · ${cachedHits} served from cache at no cost`} pad={false}>
          {searches.length === 0 ? <div className="card-pad"><Empty title="No searches yet" /></div> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>When</th><th>Question</th><th>Engine</th><th>Query &amp; purpose</th><th>Found</th><th>Kept</th><th>Cost</th></tr></thead>
                <tbody>
                  {searches.map((q) => (
                    <tr key={q.id}>
                      <td className="muted whitespace-nowrap text-xs">{ago(q.createdAt)}</td>
                      <td className="text-xs">{q.key.replace(/_/g, " ")}<div className="muted text-[0.7rem]">{q.pass}</div></td>
                      <td>{q.cached ? <Badge color="#0D9488">cache</Badge> : q.error ? <Badge color="#DC2626" title={q.error}>{q.engine} ✕</Badge> : <Badge color="#4F46E5">{q.engine}</Badge>}</td>
                      <td className="max-w-[340px] text-xs"><div className="mono truncate" title={q.query}>{q.query}</div>{q.purpose && <div className="muted truncate" title={q.purpose}>{q.purpose}</div>}</td>
                      <td className="tnum">{q.results}</td>
                      <td className="tnum font-semibold" style={{ color: q.kept ? "#059669" : undefined }}>{q.cached ? "—" : q.kept}</td>
                      <td className="tnum muted text-xs">{q.costMicros ? `$${(q.costMicros / 1e6).toFixed(3)}` : "free"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid content-start gap-5">
        <Card title={<span className="inline-flex items-center gap-2"><FlaskConical size={16} /> Research hypotheses</span>} sub={plan ? `Planned by ${plan.planner ?? "rules"} · ${ago(plan.createdAt)}` : undefined}>
          {!plan?.hypotheses.length ? <span className="muted text-xs">None recorded</span> : <ul className="grid gap-2 text-sm secondary">{plan.hypotheses.map((h, i) => <li key={i}>· {h}</li>)}</ul>}
          {plan && (
            <div className="mt-4 grid gap-2 text-xs">
              <div className="micro">Question → engine</div>
              {(plan.questions as { key: string; engine?: string; why?: string }[]).map((q) => (
                <div key={q.key} className="flex items-start justify-between gap-2"><span className="secondary" title={q.why}>{q.key.replace(/_/g, " ")}</span><Badge color="#64748B">{q.engine ?? "auto"}</Badge></div>
              ))}
            </div>
          )}
        </Card>
        {brief && (
          <>
            <Card title="Confirm in discovery" sub="Not verified — ask, don't assert">
              {brief.hypotheses.length ? <ul className="grid gap-2 text-sm secondary">{brief.hypotheses.map((h, i) => <li key={i}>· {h}</li>)}</ul> : <span className="muted text-xs">Nothing open</span>}
            </Card>
            <Card title="Risks">
              {brief.risks.length ? <ul className="grid gap-2 text-sm">{brief.risks.map((r, i) => <li key={i} className="flex gap-2" style={{ color: "#B45309" }}><ShieldAlert size={14} className="mt-0.5 shrink-0" />{r}</li>)}</ul> : <span className="muted text-xs">None spotted</span>}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function FactRefs({ ids, facts }: { ids: string[]; facts: Map<string, TwinSnapshot["facts"][number]> }) {
  const list = ids.map((id) => facts.get(id)).filter(Boolean) as TwinSnapshot["facts"];
  if (!list.length) return null;
  return (
    <ul className="mt-2 grid gap-1">
      {list.map((f) => (
        <li key={f.id} className="mono muted text-[0.7rem]">
          ↳ <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">{f.claim.slice(0, 110)}{f.claim.length > 110 ? "…" : ""} · {new URL(f.sourceUrl).hostname}</a> · {f.status}
        </li>
      ))}
    </ul>
  );
}
