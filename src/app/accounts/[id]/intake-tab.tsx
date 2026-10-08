import type { Account } from "@prisma/client";
import { ArrowRight, Database, FileInput, Search, Sparkles, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { importContext, intakeMap } from "@/lib/research/intake";
import { questionLabel } from "@/lib/research/keys";
import { STAGE_INFO, stageLabel } from "@/lib/journey/stages";
import { Badge, Card, Empty, FieldBadge, ago, date } from "@/components/ui";
import type { FieldStatus } from "@prisma/client";

const label = questionLabel;

function Source({ s }: { s: string | null }) {
  if (!s) return <span className="muted">—</span>;
  const m = s.match(/^research: (https?:\/\/\S+)/);
  if (m) {
    let host = m[1];
    try {
      host = new URL(m[1]).hostname;
    } catch {}
    return <a href={m[1]} target="_blank" rel="noreferrer" className="hover:underline"><Badge color="#7C3AED">research</Badge> <span className="mono text-[0.7rem]">{host}</span></a>;
  }
  return <span className="text-xs"><Badge color="#0D9488">import</Badge> <span className="muted">{s}</span></span>;
}

/** The import → research stream for one company: what came in, what was missing, what research asked and found. */
export async function IntakeTab({ account }: { account: Account }) {
  const [fields, ctx, plan, searches, gapEvents, importEvents, contacts] = await Promise.all([
    intakeMap(account),
    importContext(account),
    db.researchPlan.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } }),
    db.researchQuery.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } }),
    db.pipelineEvent.findMany({ where: { accountId: account.id, step: { startsWith: "intake." } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.pipelineEvent.findMany({ where: { accountId: account.id, step: "data_input.receive_record" }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null }, include: { journeys: { include: { sender: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const evidence = await db.evidence.groupBy({ by: ["key"], where: { accountId: account.id, supersededById: null, flagged: false }, _count: true });
  const questions = (plan?.questions ?? []) as { key: string; why?: string; engine?: string; query?: string }[];
  const skipped = (plan?.skipped ?? []) as { key: string; reason: string }[];
  const latest = (key: string) => searches.find((q) => q.key === key);
  const facts = (key: string) => evidence.find((e) => e.key === key)?._count ?? 0;
  const gaps = fields.filter((f) => f.gap);
  const imported = contacts.filter((c) => c.source !== "mock-provider" && !/provider/.test(c.source));

  return (
    <div className="grid gap-5">
      <div className="glass-card-static card-pad">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge color="#0D9488"><FileInput size={12} className="mr-1 inline" />Import</Badge><ArrowRight size={14} className="muted" />
          <Badge color="#B45309"><Database size={12} className="mr-1 inline" />Intake map · {gaps.length ? `${gaps.length} gap${gaps.length > 1 ? "s" : ""}` : "complete"}</Badge><ArrowRight size={14} className="muted" />
          <Badge color="#7C3AED"><Search size={12} className="mr-1 inline" />Research · {plan?.depth ?? "not planned yet"}</Badge><ArrowRight size={14} className="muted" />
          <Badge color="#4F46E5"><Sparkles size={12} className="mr-1 inline" />AI brief</Badge>
        </div>
        <p className="secondary mt-2 text-sm">Everything the CSV brought in is mapped below. Missing basics are researched before fit and identity run; what the import already answered is not searched again; LinkedIn conversations from the import decide how deep research goes.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="1 · What we hold for this company" sub="Value, where it came from, and how sure we are" pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Status</th></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key}>
                    <td className="strong">{f.label}</td>
                    <td className="max-w-[220px] truncate text-xs" title={f.value ?? ""}>{f.value ?? <span style={{ color: f.gap ? "#B45309" : undefined }}>{f.gap ? "missing — researched" : "—"}</span>}</td>
                    <td className="max-w-[200px] truncate"><Source s={f.value ? f.source : null} /></td>
                    <td>{f.status === "missing" ? <Badge color={f.gap ? "#B45309" : "#94A3B8"}>missing</Badge> : f.status === "unknown" ? <Badge color="#64748B">unverified</Badge> : <FieldBadge status={f.status as FieldStatus} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="2 · Gaps filled by research" sub="Run before fit and identity, so they use the filled values">
          {gapEvents.length === 0 ? <Empty title="No gaps to fill" sub="The import gave website, industry, size and country." /> : (
            <ul className="timeline">
              {gapEvents.map((e) => (
                <li key={e.id} className="tl-item" style={{ ["--tl" as string]: e.outcome === "pass" ? "#10B981" : e.outcome === "block" ? "#F59E0B" : "#94A3B8" }}>
                  <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="secondary">{e.reason}</span><span className="mono muted text-xs">{ago(e.createdAt)}</span></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="3 · Research plan → what it found" sub={plan ? `${plan.depth ?? ""} · planned by ${plan.planner ?? "rules"} · ${ago(plan.createdAt)}` : "Runs after the intake"} pad={false}>
        {!plan ? <div className="card-pad"><Empty title="Not researched yet" /></div> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Question</th><th>Why it was asked</th><th>Search</th><th>Result</th></tr></thead>
              <tbody>
                {questions.map((q) => {
                  const s = latest(q.key);
                  const n = facts(q.key);
                  return (
                    <tr key={q.key}>
                      <td className="strong whitespace-nowrap">{label(q.key)}</td>
                      <td className="max-w-[280px] text-xs secondary">{q.why}</td>
                      <td className="max-w-[260px] text-xs">{s ? <><Badge color={s.cached ? "#0D9488" : "#4F46E5"}>{s.cached ? "cache" : s.engine}</Badge><div className="mono muted mt-1 truncate" title={s.query}>{s.query}</div></> : <span className="muted">—</span>}</td>
                      <td className="whitespace-nowrap text-xs">{n ? <Badge color="#059669">{n} fact{n > 1 ? "s" : ""}</Badge> : q.key === "negative" ? <Badge color="#059669">none found (good)</Badge> : <Badge color="#94A3B8">nothing found</Badge>}</td>
                    </tr>
                  );
                })}
                {skipped.map((q) => (
                  <tr key={`skip-${q.key}`} className="opacity-70">
                    <td className="whitespace-nowrap">{label(q.key)}</td>
                    <td className="text-xs muted" colSpan={2}>Not asked: {q.reason}</td>
                    <td className="text-xs">{facts(q.key) ? <Badge color="#059669">{facts(q.key)} held</Badge> : <Badge color="#94A3B8">skipped</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="4 · People and conversations from the import" sub="Replies on LinkedIn earn a deep dive and shape the AI brief">
          {imported.length === 0 ? <Empty icon={<UserRound size={20} />} title="No people imported" /> : (
            <ul className="grid gap-2 text-sm">
              {imported.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><b style={{ color: "var(--text-primary)" }}>{c.fullName}</b> <span className="secondary">· {c.title ?? "—"}</span></span>
                  <span className="flex flex-wrap gap-1">{c.journeys.length ? c.journeys.map((j) => <span key={j.id} title={j.sender.name}><Badge color={STAGE_INFO[j.stage].color}>{stageLabel(j.stage, j.followUpCount)}</Badge></span>) : <span className="muted text-xs">no journey</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {ctx.conversations.length > 0 && (
            <div className="mt-3 rounded-xl px-3 py-2 text-xs secondary" style={{ background: "var(--surface-card-header)" }}>
              <b style={{ color: "var(--text-primary)" }}>Effect on research:</b> {ctx.conversations.map((c) => `${c.name} is ${c.stage.toLowerCase()}${c.lastReply ? ` ("${c.lastReply.slice(0, 60)}")` : ""}`).join("; ")} → deep dive, and the AI brief builds on the conversation.
            </div>
          )}
          {(ctx.technologies.length > 0 || ctx.keywords.length > 0 || ctx.notes) && (
            <div className="mt-3 grid gap-1 text-xs secondary">
              {ctx.technologies.length > 0 && <div><b style={{ color: "var(--text-primary)" }}>Systems from import:</b> {ctx.technologies.join(", ")} → not searched again</div>}
              {ctx.keywords.length > 0 && <div><b style={{ color: "var(--text-primary)" }}>Keywords:</b> {ctx.keywords.join(", ")} → added to trigger and expansion searches</div>}
              {ctx.notes && <div><b style={{ color: "var(--text-primary)" }}>Team notes:</b> {ctx.notes} → given to the AI brief</div>}
            </div>
          )}
        </Card>

        <Card title="5 · Import history for this company" sub="Every upload that touched it and what changed">
          {importEvents.length === 0 ? <Empty title="Not imported (added by hand or API)" /> : (
            <ul className="timeline">
              {importEvents.map((e) => (
                <li key={e.id} className="tl-item" style={{ ["--tl" as string]: "#0D9488" }}>
                  <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="secondary">{e.reason}</span><span className="mono muted text-xs">{date(e.createdAt)}</span></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
