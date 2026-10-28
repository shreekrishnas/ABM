import { ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { Badge, EmptyState } from "@/components/kit";
import { CLASS_CLAIM, CLASS_LABEL, type Classification } from "@/lib/brain/research-types";
import type { TraceRound } from "@/lib/brain/investigate";
import type { Completeness } from "@/lib/brain/completeness";

const CLASS_TONE: Record<Classification, "neutral" | "info" | "warning" | "success" | "accent" | "danger"> = {
  irrelevant: "neutral", inconclusive: "neutral", verified_event: "info", relevant_development: "warning", supported_opportunity: "success", direct_intent: "accent",
};
const STATUS_LABEL: Record<string, string> = { open: "Open", supported: "Supported, not validated", validated: "Validated", refuted: "Refuted", rejected: "Rejected by validator" };
const PURPOSE_LABEL: Record<string, string> = { baseline: "Baseline", confirm: "Confirm", disconfirm: "Try to disprove", connect: "Connect", discover: "Discover" };
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** What the AI investigated, why each question was asked, what it concluded and how the validator judged it. */
export async function ResearchTrace({ accountId }: { accountId: string }) {
  const run = await db.researchRun.findFirst({ where: { accountId }, orderBy: { createdAt: "desc" } });
  if (!run) return <EmptyState title="No investigation yet" text="The investigation runs after the baseline research. Run the pipeline to start it." />;
  const [hyps, links] = await Promise.all([
    db.hypothesis.findMany({ where: { accountId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] }),
    db.evidenceLink.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = [...new Set(hyps.flatMap((h) => [...h.supportIds, ...h.counterIds]))];
  const facts = ids.length ? await db.evidence.findMany({ where: { id: { in: ids } } }) : [];
  const fact = new Map(facts.map((f) => [f.id, f]));
  const trace = (run.trace as unknown as TraceRound[]) ?? [];
  const refText = (ref: string) => {
    const [kind, id] = [ref.split(":")[0], ref.slice(ref.indexOf(":") + 1)];
    if (kind === "fact") return `“${(fact.get(id)?.claim ?? "a fact").slice(0, 70)}”`;
    if (kind === "capability") return id.replace(/_/g, " ");
    if (kind === "hypothesis") return "this hypothesis";
    return id;
  };
  const comp = run.completeness as unknown as Completeness | null;

  return (
    <div className="rt">
      <section className="rt-head">
        <Badge tone={run.status === "complete" ? "success" : run.status === "incomplete" ? "warning" : "info"}>{run.status === "complete" ? "Research complete" : run.status === "incomplete" ? "Research incomplete" : "In progress"}</Badge>
        <span>{trace.length} round{trace.length === 1 ? "" : "s"} · {trace.reduce((n, r) => n + r.questions.length, 0)} questions</span>
        {run.stopReason && <span className="rt-muted">Stopped: {run.stopReason}</span>}
      </section>

      {comp && (
        <section className="rt-card">
          <h3>Completeness</h3>
          <ul className="rt-checks">
            {comp.checks.map((c) => (
              <li key={c.key}><Badge tone={c.pass ? "success" : "warning"}>{c.pass ? "✓" : "!"}</Badge><b>{c.label}</b><span className="rt-muted">{c.detail}</span></li>
            ))}
          </ul>
          {comp.nextQuestions.length > 0 && <p className="rt-muted">Next best questions: {comp.nextQuestions.join(" · ")}</p>}
        </section>
      )}

      <section className="rt-card">
        <h3>Conclusions</h3>
        {hyps.length === 0 ? (
          <p className="rt-muted">No development with a defensible link to the client&apos;s offering was found.</p>
        ) : (
          <ul className="rt-hyps">
            {hyps.map((h) => {
              const cls = (h.classification as Classification) ?? "inconclusive";
              return (
                <li key={h.id} className={h.status === "rejected" || h.status === "refuted" ? "rt-dim" : ""}>
                  <div className="rt-hyp-top">
                    <Badge tone={CLASS_TONE[cls]}>{CLASS_LABEL[cls]}</Badge>
                    <Badge tone={h.status === "validated" ? "success" : h.status === "rejected" ? "danger" : "neutral"}>{STATUS_LABEL[h.status] ?? h.status}</Badge>
                    {h.useCase && <span className="rt-muted">{h.useCase.replace(/_/g, " ")}</span>}
                  </div>
                  <p className="rt-hyp-text">{h.text}</p>
                  <p className="rt-muted">May be stated as: “{CLASS_CLAIM[cls]}”</p>
                  {h.rationale && <p className="rt-small">{h.rationale}</p>}
                  {h.assumptions.length > 0 && <p className="rt-small"><b>Assumptions:</b> {h.assumptions.join("; ")}</p>}
                  {h.alternatives.length > 0 && <p className="rt-small"><b>Other explanations:</b> {h.alternatives.join("; ")}</p>}
                  {h.validatorNote && <p className="rt-small"><b>Validator:</b> {h.validatorNote}</p>}
                  <ul className="rt-facts">
                    {h.supportIds.map((id) => fact.get(id)).filter(Boolean).map((f) => (
                      <li key={f!.id}><Badge tone="success">For</Badge> {f!.claim} <a href={f!.sourceUrl} target="_blank" rel="noreferrer">{f!.publisher ?? host(f!.sourceUrl)} · {f!.publishedAt.toISOString().slice(0, 10)}{f!.fullText ? "" : " · snippet"} <ExternalLink size={11} aria-hidden /></a></li>
                    ))}
                    {h.counterIds.map((id) => fact.get(id)).filter(Boolean).map((f) => (
                      <li key={f!.id}><Badge tone="danger">Against</Badge> {f!.claim} <a href={f!.sourceUrl} target="_blank" rel="noreferrer">{f!.publisher ?? host(f!.sourceUrl)} <ExternalLink size={11} aria-hidden /></a></li>
                    ))}
                  </ul>
                  {links.filter((l) => l.hypothesisId === h.id).length > 0 && (
                    <ul className="rt-links">
                      {links.filter((l) => l.hypothesisId === h.id).map((l) => (
                        <li key={l.id}><span>{refText(l.fromRef)}</span> <b>{l.relation.replace(/_/g, " ")}</b> <span>{refText(l.toRef)}</span>{l.isHypothesis && <Badge tone="warning">Assumption</Badge>} <span className="rt-muted">{l.rationale}</span></li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rt-card">
        <h3>Investigation rounds</h3>
        <ol className="rt-rounds">
          {trace.map((r) => (
            <li key={r.round}>
              <p className="rt-round-h">Round {r.round}{r.note ? ` · ${r.note}` : ""}</p>
              <ul>
                {r.questions.map((q, i) => (
                  <li key={i}>
                    <Badge tone={q.purpose === "disconfirm" ? "warning" : "neutral"}>{PURPOSE_LABEL[q.purpose] ?? q.purpose}</Badge> {q.question}
                    <span className="rt-muted"> — {q.why} · value {q.value}/5 · {q.found} page{q.found === 1 ? "" : "s"}, {q.kept} fact{q.kept === 1 ? "" : "s"} kept</span>
                    <div className="mono rt-small">{q.query}</div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
