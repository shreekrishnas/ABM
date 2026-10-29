import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, Search, ShieldCheck, XCircle } from "lucide-react";
import type { ProspectSuggestion } from "@prisma/client";
import { db } from "@/lib/db";
import { activeSeller } from "@/lib/scope";
import { ActionForm, SubmitButton } from "@/components/client";
import { DIMENSION_LABEL, FIT_WEIGHTS, lookalikeCriteria, type LookalikeEvidence, type LookalikeResearch } from "@/lib/discover/lookalike";
import { approveSuggestionsAction, rejectLookalikeAction, researchMoreAction } from "../../actions";
import { RefreshWhileResearching } from "./refresh";

const READINESS: Record<string, { label: string; tone: string; text: string }> = {
  ready: { label: "Ready", tone: "hot", text: "Recent, verified buying event tied to the offering" },
  emerging: { label: "Emerging", tone: "warm", text: "A relevant change is underway" },
  early: { label: "Early", tone: "cold", text: "Good fit, no current buying event" },
  none: { label: "No need seen", tone: "none", text: "Evidence suggests no current need" },
};

const VIEWS = [
  { key: "review", label: "To review" },
  { key: "researching", label: "Researching" },
  { key: "approved", label: "Approved" },
  { key: "aside", label: "Rejected or ruled out" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const viewOf = (r: ProspectSuggestion): View =>
  r.status === "added" ? "approved"
  : r.status === "dismissed" || r.status === "excluded" ? "aside"
  : r.researchStatus === "queued" || r.researchStatus === "running" ? "researching"
  : "review";

const href = (seed: string | undefined, view: View) => `/import/lookalikes?${new URLSearchParams({ ...(seed ? { seed } : {}), view })}`;

/** Lookalikes from one reference company (or all), each with its fit, readiness, reasons and evidence. A person decides. */
export async function LookalikeReview({ seed, view = "review" }: { seed?: string; view?: string }) {
  const sellerId = (await activeSeller()).id;
  const rows = await db.prospectSuggestion.findMany({
    where: { sellerId, origin: "lookalike", ...(seed ? { seed } : {}) },
    orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 150,
  });
  const crit = lookalikeCriteria();
  const by = Object.fromEntries(VIEWS.map((v) => [v.key, rows.filter((r) => viewOf(r) === v.key)])) as Record<View, ProspectSuggestion[]>;
  const current: View = VIEWS.some((v) => v.key === view) ? (view as View) : "review";
  const list = by[current];
  const working = by.researching.length > 0;

  if (!rows.length) return <p className="lk-empty">{seed ? `No similar companies saved for ${seed} yet.` : "Enter a website above. The AI finds similar companies, researches each one, and lists them here for you to approve."}</p>;

  return (
    <section className="lk">
      <RefreshWhileResearching active={working} />
      <nav className="k-seg lk-tabs" aria-label="Lookalike status">
        {VIEWS.map((v) => (
          <Link key={v.key} href={href(seed, v.key)} aria-current={current === v.key ? "page" : undefined} className={current === v.key ? "on" : undefined}>
            {v.label} <span className="tnum">{by[v.key].length}</span>
          </Link>
        ))}
      </nav>
      <p className="lk-rule">
        Contacts are looked up in Apollo only after you approve a company. Recommended from a fit of {crit.minFit}
        {crit.focus.length ? <> · must share: {crit.focus.join(", ")}</> : null}
        {crit.avoid.length ? <> · ruled out: {crit.avoid.join(", ")}</> : null} · <Link href="/brain">change in Account Brain</Link>
      </p>
      {list.length === 0 ? (
        <p className="lk-empty">{current === "review" && working ? "The AI is still researching these companies. Results appear here as each one finishes." : "Nothing here."}</p>
      ) : (
        <ul className="lk-list">{list.map((r) => <LookalikeCard key={r.id} r={r} />)}</ul>
      )}
    </section>
  );
}

function LookalikeCard({ r }: { r: ProspectSuggestion }) {
  const research = (r.research ?? null) as LookalikeResearch | null;
  const evidence = ((r.evidence ?? []) as unknown as LookalikeEvidence[]) ?? [];
  const verified = evidence.filter((e) => e.verified).length;
  const busy = r.researchStatus === "queued" || r.researchStatus === "running";
  const ready = r.readiness ? READINESS[r.readiness] : null;
  const questions = research?.rounds.reduce((n, x) => n + x.questions.length, 0) ?? 0;
  const fitTone = r.fitScore == null ? "" : r.fitScore >= 75 ? " hi" : r.fitScore >= 55 ? " mid" : " lo";
  const decided = r.status === "added" || r.status === "dismissed";

  return (
    <li className="lk-card">
      <header className="lk-top">
        <div className="min-w-0">
          <h3>{r.name}</h3>
          <p className="lk-meta">{[r.domain, r.industry, r.country ?? "country unknown", r.employees != null ? `${r.employees.toLocaleString()} employees` : null].filter(Boolean).join(" · ")}</p>
          {r.seed && <p className="lk-meta">Like {r.seed}</p>}
        </div>
        <div className="lk-scores">
          {busy ? (
            <span className="lk-busy"><Loader2 size={14} className="spin" aria-hidden /> {r.researchStatus === "running" ? "Researching" : "Queued"}</span>
          ) : (
            <>
              <span className={`lk-fit${fitTone}`} title="Lookalike fit: how closely it matches the reference company and needs the offering">
                <b className="tnum">{r.fitScore ?? "—"}</b><small>fit</small>
              </span>
              {ready && <span className={`lk-ready ${ready.tone}`} title={ready.text}>{ready.label}{r.readinessScore != null && <span className="tnum"> {r.readinessScore}</span>}</span>}
            </>
          )}
        </div>
      </header>

      {r.status === "added" && <p className="lk-note ok"><CheckCircle2 size={14} aria-hidden /> Approved{r.decidedBy ? ` by ${r.decidedBy}` : ""}. {r.accountId && <Link href={`/accounts/${r.accountId}`}>Open the company</Link>}</p>}
      {(r.status === "dismissed" || r.status === "excluded") && <p className="lk-note no"><XCircle size={14} aria-hidden /> {r.reason ?? (r.status === "dismissed" ? "Rejected" : "Outside the targeting rule")}{r.decidedBy ? ` · ${r.decidedBy}` : ""}</p>}
      {r.researchStatus === "failed" && <p className="lk-note no">The investigation failed: {research?.error ?? "unknown error"}. Try Research more.</p>}
      {busy && r.researchNote && <p className="lk-note">Looking into: {r.researchNote}</p>}

      {r.reasons.length > 0 && (
        <ul className="lk-reasons">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      )}
      {research?.concerns?.length ? <p className="lk-concern"><b>Watch out:</b> {research.concerns.join(" · ")}</p> : null}

      {research?.dims && (
        <dl className="lk-dims">
          {(Object.keys(FIT_WEIGHTS) as (keyof typeof FIT_WEIGHTS)[]).map((k) => (
            <div key={k}>
              <dt>{DIMENSION_LABEL[k]}</dt>
              <dd><span className="lk-bar"><span style={{ width: `${Math.max(0, Math.min(100, research.dims[k]))}%` }} /></span><span className="tnum">{research.dims[k]}</span></dd>
            </div>
          ))}
        </dl>
      )}

      {evidence.length > 0 && (
        <details className="lk-more">
          <summary>Evidence: {evidence.length} fact{evidence.length === 1 ? "" : "s"}, {verified} verified</summary>
          <ul className="lk-ev">
            {evidence.map((e, i) => (
              <li key={i}>
                <span className="lk-tag">{DIMENSION_LABEL[e.dimension]}</span>
                {e.verified ? <span className="lk-ver" title={`Stated by ${e.sources} independent source${e.sources === 1 ? "" : "s"}`}><ShieldCheck size={12} aria-hidden /> Verified</span> : <span className="lk-one">One source</span>}
                <p>{e.claim}</p>
                <blockquote>“{e.quote}”</blockquote>
                <span className="lk-src">{e.urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{hostOf(u)} <ExternalLink size={11} aria-hidden /></a>)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {research?.rounds?.length ? (
        <details className="lk-more">
          <summary>How it was researched: {research.rounds.length} round{research.rounds.length === 1 ? "" : "s"}, {questions} question{questions === 1 ? "" : "s"}</summary>
          <ol className="lk-rounds">
            {research.rounds.map((x) => (
              <li key={x.round}>
                <b>Round {x.round}</b>{x.why ? <span className="lk-meta"> · {x.why}</span> : null}
                <ul>{x.questions.map((q, i) => <li key={i}><Search size={11} aria-hidden /> {q.question} <span className="lk-meta">({q.engine}, {q.found} page{q.found === 1 ? "" : "s"}, {q.kept} fact{q.kept === 1 ? "" : "s"} kept)</span></li>)}</ul>
              </li>
            ))}
          </ol>
          <p className="lk-meta">Stopped: {research.stopReason}{research.note ? ` · asked to look into: ${research.note}` : ""}</p>
        </details>
      ) : null}

      {!decided && !busy && (
        <div className="lk-actions">
          <ActionForm action={approveSuggestionsAction} resetOnSuccess={false}>
            <input type="hidden" name="ids" value={r.id} />
            <SubmitButton className="btn btn-primary btn-sm">Approve</SubmitButton>
          </ActionForm>
          <ActionForm action={researchMoreAction.bind(null, r.id)} className="lk-inline">
            <input name="note" className="glass-input" placeholder="What should the AI look into? (optional)" aria-label={`What to research about ${r.name}`} maxLength={300} />
            <SubmitButton className="btn btn-secondary btn-sm">Research more</SubmitButton>
          </ActionForm>
          <ActionForm action={rejectLookalikeAction.bind(null, r.id)} className="lk-inline">
            <input name="reason" className="glass-input" placeholder="Reason (optional)" aria-label={`Why reject ${r.name}`} maxLength={200} />
            <SubmitButton className="btn btn-secondary btn-sm">Reject</SubmitButton>
          </ActionForm>
        </div>
      )}
      {r.status === "excluded" && !busy && (
        <div className="lk-actions">
          <ActionForm action={researchMoreAction.bind(null, r.id)} className="lk-inline">
            <input name="note" className="glass-input" placeholder="What should the AI check again?" aria-label={`What to research about ${r.name}`} maxLength={300} />
            <SubmitButton className="btn btn-secondary btn-sm">Research more</SubmitButton>
          </ActionForm>
        </div>
      )}
    </li>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
