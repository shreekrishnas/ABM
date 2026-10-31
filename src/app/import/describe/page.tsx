import Link from "next/link";
import { db } from "@/lib/db";
import { ensureSellerPacks } from "@/lib/seller";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, PageHeader, ago } from "@/components/ui";
import type { DiscoveryCriteria } from "@/lib/discover/describe";
import { LookalikeReview } from "../lookalikes/review";
import { draftDiscoveryAction, runDiscoveryAction } from "./actions";

export const metadata = { title: "Describe companies · Import" };
export const maxDuration = 300;

const EXAMPLES = [
  "Indian pharmaceutical manufacturers with more than 5,000 employees that are moving to SAP S/4HANA",
  "FMCG companies in India and the UAE that sell through large distributor networks and are expanding into new regions",
  "Indian fintech or NBFC lenders that raised a Series B or later in the last 24 months",
];

function Field({ label, name, value, hint, wide, area }: { label: string; name: string; value: string; hint?: string; wide?: boolean; area?: boolean }) {
  return (
    <label className={`grid gap-1 text-xs ${wide ? "sm:col-span-2" : ""}`}>
      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
      {area ? <textarea name={name} defaultValue={value} className="glass-textarea" rows={3} /> : <input name={name} defaultValue={value} className="glass-input" />}
      {hint && <span className="muted">{hint}</span>}
    </label>
  );
}

export default async function DescribePage({ searchParams }: { searchParams: Promise<{ search?: string; view?: string }> }) {
  await ensureSellerPacks();
  const { search: id, view } = await searchParams;
  const [current, recent] = await Promise.all([
    id ? db.discoverySearch.findUnique({ where: { id } }) : Promise.resolve(null),
    db.discoverySearch.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const c = current?.criteria as unknown as DiscoveryCriteria | undefined;
  const run = current?.queries as unknown as { runs?: { query: string; engine: string; pages: number; companies: number; error?: string }[]; skipped?: { name: string; reason: string }[]; found?: number; excluded?: number } | null;

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Import data · Describe companies"
        title="Find companies from a description"
        sub="Say what you're looking for in plain words. The AI drafts precise criteria for you to check and edit, searches the web (Exa and Tavily), keeps only companies the sources actually name, researches each one against your criteria and lists them for approval. Contacts are looked up only after you approve a company."
      />

      <Card className="mb-5">
        <ActionForm action={draftDiscoveryAction} className="grid gap-2">
          <textarea name="brief" className="glass-textarea" rows={3} placeholder={EXAMPLES[0]} aria-label="Describe the companies you want" defaultValue={current?.brief ?? ""} required minLength={15} maxLength={1000} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="muted text-xs">Include what matters: industry, country, size, business model, systems they use, funding, what they must be doing now.</span>
            <SubmitButton className="btn btn-primary">Draft criteria</SubmitButton>
          </div>
        </ActionForm>
        {!current && (
          <div className="mt-3 grid gap-1 text-xs">
            <span className="muted">For example:</span>
            {EXAMPLES.map((e) => <span key={e} className="secondary">“{e}”</span>)}
          </div>
        )}
      </Card>

      {current && c && (
        <Card className="mb-5" title={current.status === "draft" ? "Check the criteria, then search" : "Criteria"} sub={`From: “${current.brief}”${current.createdBy ? ` · started by ${current.createdBy}` : ""} · ${ago(current.createdAt)}`}>
          <ActionForm action={runDiscoveryAction.bind(null, current.id)} className="grid gap-4" resetOnSuccess={false}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="In one sentence" name="summary" value={c.summary} wide />
              <Field label="Industries" name="industries" value={c.industries.join(", ")} hint="Comma separated" />
              <Field label="Countries" name="countries" value={c.countries.join(", ")} hint="Country codes or names; empty = any" />
              <Field label="Minimum employees" name="minEmployees" value={c.minEmployees?.toString() ?? ""} />
              <Field label="Maximum employees" name="maxEmployees" value={c.maxEmployees?.toString() ?? ""} />
              <Field label="Business models" name="businessModels" value={c.businessModels.join(", ")} />
              <Field label="Technologies" name="technologies" value={c.technologies.join(", ")} hint="Products they use or are moving to" />
              <Field label="Must have" name="mustHave" value={c.mustHave.join(", ")} hint="Checked for every company during research" />
              <Field label="Rule out" name="exclude" value={c.exclude.join(", ")} />
              <Field label="Nice to have" name="niceToHave" value={c.niceToHave.join(", ")} />
              <Field label="Buying signals" name="signals" value={c.signals.join(", ")} hint="Events you want to see: expansion, ERP migration, new plant…" />
              <Field label="Funding stages" name="fundingStages" value={c.funding?.stages.join(", ") ?? ""} hint="e.g. Series B, Series C" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min. raised (USD)" name="fundingMinUsd" value={c.funding?.minAmountUsd?.toString() ?? ""} />
                <Field label="Within months" name="fundingWithinMonths" value={c.funding?.withinMonths?.toString() ?? ""} />
              </div>
              <Field label="Web searches (one per line)" name="queries" value={c.queries.join("\n")} wide area hint="3 to 6 searches that surface lists or news naming such companies" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="muted text-xs">Countries and size are checked by code before research; must-haves, technologies, funding and signals are checked by the AI investigation with quoted sources.</span>
              <SubmitButton className="btn btn-brand">{current.status === "draft" ? "Search with these criteria" : "Search again"}</SubmitButton>
            </div>
          </ActionForm>
          {current.status === "failed" && <p className="mt-3 text-xs" style={{ color: "var(--danger-strong)" }}>The last search failed: {current.error}</p>}
          {run?.runs?.length ? (
            <details className="lk-more mt-4">
              <summary>How it searched: {run.runs.length} search{run.runs.length === 1 ? "" : "es"}, {run.found ?? 0} companies found, {current.candidates} researched{run.excluded ? `, ${run.excluded} outside the targeting rule` : ""}</summary>
              <ul className="mt-2 grid gap-1 text-xs">
                {run.runs.map((q) => <li key={q.query}><span className="mono">{q.query}</span> <span className="muted">({q.engine}: {q.error ? `failed: ${q.error}` : `${q.pages} page${q.pages === 1 ? "" : "s"}, ${q.companies} compan${q.companies === 1 ? "y" : "ies"}`})</span></li>)}
              </ul>
              {run.skipped?.length ? <p className="muted mt-2 text-xs">Skipped: {run.skipped.slice(0, 12).map((s) => `${s.name} (${s.reason})`).join(" · ")}</p> : null}
            </details>
          ) : null}
        </Card>
      )}

      {!current && recent.length > 0 && (
        <div className="lk-start">
          <section>
            <h2>Recent searches</h2>
            <ul>{recent.map((r) => <li key={r.id}><Link href={`/import/describe?search=${r.id}`}>{r.brief.slice(0, 90)}{r.brief.length > 90 ? "…" : ""}</Link><span className="tnum">{r.status === "draft" ? "draft" : `${r.candidates} researched`}{r.createdBy ? ` · ${r.createdBy}` : ""}</span></li>)}</ul>
          </section>
        </div>
      )}

      {current && current.status !== "draft" && <LookalikeReview origin="discovery" seed={`search:${current.id}`} view={view} base="/import/describe" param="search" />}
    </div>
  );
}
