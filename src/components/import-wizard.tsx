"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Loader2, Plus, Upload, XCircle } from "lucide-react";
import { analyzeHeaders, analyzeMapping, IMPORT_FIELDS, rowKeys, validateRow, type FieldGroup, type FieldKey } from "@/lib/import/fields";
import { createCampaignAction, createSenderAction, finishImportAction, importChunkAction, importResearchSummaryAction, previewMatchesAction, processImportAction, startImportAction } from "@/app/actions";

const CHUNK = 250;
const PREVIEW_CHUNK = 400; // companies per preview call (their people travel with them)
type Option = { id: string; name: string };

interface Parsed {
  file: File;
  headers: string[];
  rows: Record<string, string>[];
}

interface Preview {
  valid: number;
  invalid: number;
  sampleErrors: { row: number; error: string }[];
  duplicates: number;
  companies: number;
  people: number;
  companiesNew: number;
  companiesExisting: number;
  peopleNew: number;
  peopleExisting: number;
  journeysNew: number;
  journeysExisting: number;
  withActivity: number;
}

interface Summary {
  research: Awaited<ReturnType<typeof importResearchSummaryAction>>;
  filename: string;
  accepted: number;
  rejected: number;
  errors: { row: number; error: string }[];
  stats: Record<string, number>;
  processed: number;
  remaining: number;
}

type Phase =
  | { k: "upload" }
  | { k: "campaign" }
  | { k: "map" }
  | { k: "preview"; busy: boolean; data: Preview | null }
  | { k: "importing"; label: string; done: number; total: number }
  | { k: "finished"; summary: Summary };

const STEPS = ["Upload", "Campaign & sender", "Map fields", "Preview", "Import"];
const GROUPS: FieldGroup[] = ["Company", "People", "LinkedIn activity"];

function Bar({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs"><span className="secondary">{label}</span><span className="tnum font-semibold" style={{ color: "var(--text-primary)" }}>{value} / {total}</span></div>
      <div className="track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "#047857" : tone === "warn" ? "#B45309" : tone === "bad" ? "#B91C1C" : "var(--text-primary)";
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}>
      <div className="micro">{label}</div>
      <div className="display-num mt-1 text-2xl tnum" style={{ color }}>{value.toLocaleString()}</div>
    </div>
  );
}

const signature = (headers: string[]) => `abm-map:${[...headers].sort().join("|").toLowerCase()}`;
function loadMapping(headers: string[]): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(signature(headers));
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}
function saveMapping(headers: string[], m: Record<string, string>) {
  try {
    localStorage.setItem(signature(headers), JSON.stringify(m));
  } catch {
    // storage unavailable — mapping just isn't remembered
  }
}

function NewOption({ label, onCreate }: { label: string; onCreate: (name: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}><Plus size={13} /> New {label}</button>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="glass-input" style={{ maxWidth: 260 }} autoFocus placeholder={`${label[0].toUpperCase()}${label.slice(1)} name`} value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || name.trim().length < 2} onClick={async () => {
        setBusy(true);
        const e = await onCreate(name.trim());
        setBusy(false);
        if (e) setErr(e);
        else { setOpen(false); setName(""); setErr(null); }
      }}>Create</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="text-xs" style={{ color: "#B91C1C" }}>{err}</span>}
    </div>
  );
}

export function ImportWizard({ campaigns: initialCampaigns, senders: initialSenders }: { campaigns: Option[]; senders: Option[] }) {
  const [phase, setPhase] = useState<Phase>({ k: "upload" });
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [senders, setSenders] = useState(initialSenders);
  const [campaignId, setCampaignId] = useState(initialCampaigns[0]?.id ?? "");
  const [senderId, setSenderId] = useState(initialSenders[0]?.id ?? "");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => (parsed ? analyzeMapping(parsed.headers, mapping) : null), [parsed, mapping]);
  const step = phase.k === "upload" ? 0 : phase.k === "campaign" ? 1 : phase.k === "map" ? 2 : phase.k === "preview" ? 3 : 4;

  const reset = () => {
    setPhase({ k: "upload" });
    setParsed(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.csv$/i.test(file.name)) return setError("Please choose a .csv file (Excel: File → Save As → CSV UTF-8).");
    if (file.size > 50 * 1024 * 1024) return setError("File is larger than 50 MB. Split it into smaller files.");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (!res.data.length) return setError("No data rows found in this file.");
        setParsed({ file, headers, rows: res.data });
        // Map fields once: a file with the same columns reuses the last mapping.
        setMapping(loadMapping(headers) ?? Object.fromEntries(Object.entries(analyzeHeaders(headers).mapping)));
        setPhase({ k: "campaign" });
      },
      error: (err) => setError(`Could not read the file: ${err.message}`),
    });
  };

  const buildPreview = async () => {
    if (!parsed || !analysis) return;
    setPhase({ k: "preview", busy: true, data: null });
    saveMapping(parsed.headers, mapping);
    try {
      let invalid = 0;
      let duplicates = 0;
      let withActivity = 0;
      const sampleErrors: { row: number; error: string }[] = [];
      const companyIndex = new Map<string, number>();
      const companies: { domain: string | null; companyLinkedin: string | null; nameKey: string }[] = [];
      const seenPeople = new Set<string>();
      const people: { linkedinUrl: string | null; email: string | null; fullName: string; company: number }[] = [];
      parsed.rows.forEach((r, i) => {
        const v = validateRow(r, analysis.mapping);
        if (!v.ok) {
          invalid++;
          if (sampleErrors.length < 8) sampleErrors.push({ row: i + 2, error: v.error });
          return;
        }
        const k = rowKeys(v.row);
        // Same rules as the import: website, then company LinkedIn, then name (unless the websites differ).
        let ci = (k.domain ? companyIndex.get(`d:${k.domain}`) : undefined) ?? (k.companyLinkedin ? companyIndex.get(`l:${k.companyLinkedin}`) : undefined);
        if (ci == null) {
          const byName = companyIndex.get(`n:${k.nameKey}`);
          if (byName != null && (!k.domain || !companies[byName].domain || companies[byName].domain === k.domain)) ci = byName;
        }
        if (ci == null) {
          ci = companies.length;
          companies.push({ domain: k.domain, companyLinkedin: k.companyLinkedin, nameKey: k.nameKey });
        }
        const c = companies[ci];
        if (k.domain && !c.domain) c.domain = k.domain;
        if (k.companyLinkedin && !c.companyLinkedin) c.companyLinkedin = k.companyLinkedin;
        if (k.domain) companyIndex.set(`d:${k.domain}`, ci);
        if (k.companyLinkedin) companyIndex.set(`l:${k.companyLinkedin}`, ci);
        if (!companyIndex.has(`n:${k.nameKey}`)) companyIndex.set(`n:${k.nameKey}`, ci);
        if (k.person) {
          // LinkedIn URL, then email, then full name within the same company.
          const keys = [k.personLinkedin && `l:${k.personLinkedin}`, k.email && `e:${k.email}`, `n:${ci}|${k.fullName!.toLowerCase()}`].filter(Boolean) as string[];
          if (keys.some((x) => seenPeople.has(x))) duplicates++;
          else people.push({ linkedinUrl: k.personLinkedin, email: k.email, fullName: k.fullName!, company: ci });
          keys.forEach((x) => seenPeople.add(x));
          if (v.row.activity) withActivity++;
        }
      });
      const totals = { companiesNew: 0, companiesExisting: 0, peopleNew: 0, peopleExisting: 0, journeysNew: 0, journeysExisting: 0 };
      // Companies and their people go together so people can be matched by name within a company.
      for (let i = 0; i < companies.length; i += PREVIEW_CHUNK) {
        const cSlice = companies.slice(i, i + PREVIEW_CHUNK);
        const pSlice = people.filter((p) => p.company >= i && p.company < i + PREVIEW_CHUNK).map((p) => ({ ...p, company: p.company - i }));
        if (!cSlice.length && !pSlice.length) continue;
        const r = await previewMatchesAction({ companies: cSlice, people: pSlice, campaignId, senderId });
        for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
      }
      setPhase({ k: "preview", busy: false, data: { valid: parsed.rows.length - invalid, invalid, sampleErrors, duplicates, companies: companies.length, people: people.length, withActivity, ...totals } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
      setPhase({ k: "map" });
    }
  };

  const run = async () => {
    if (!parsed || !analysis) return;
    const { file, headers, rows } = parsed;
    try {
      const start = await startImportAction({ filename: file.name, rows: rows.length, headers, mapping, campaignId, senderId });
      if (!start.ok) return setError(start.message);
      let accepted = 0;
      let rejected = 0;
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        setPhase({ k: "importing", label: "Creating linked records and sender journeys (step 1 of 2)", done: i, total: rows.length });
        const res = await importChunkAction(start.batchId, rows.slice(i, i + CHUNK), i);
        if (!res.ok) throw new Error(res.message);
        accepted += res.accepted;
        rejected += res.rejected;
        if (errors.length < 100) errors.push(...res.errors);
      }
      const fin = await finishImportAction(start.batchId);
      let remaining = fin.toProcess;
      let processed = 0;
      while (remaining > 0) {
        setPhase({ k: "importing", label: "Running the pipeline on new and changed companies (step 2 of 2)", done: fin.toProcess - remaining, total: fin.toProcess });
        const p = await processImportAction(start.batchId);
        processed += p.processed;
        if (p.processed === 0 && p.remaining >= remaining) break; // stuck: leave the rest for the scheduler
        remaining = p.remaining;
      }
      const research = await importResearchSummaryAction(start.batchId).catch(() => null);
      setPhase({ k: "finished", summary: { research, filename: file.name, accepted, rejected, errors, stats: fin.stats as unknown as Record<string, number>, processed, remaining } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setPhase({ k: "map" });
    }
  };

  const campaignName = campaigns.find((c) => c.id === campaignId)?.name;
  const senderName = senders.find((s) => s.id === senderId)?.name;
  const sample = (h: string) => parsed?.rows.find((r) => r[h]?.trim())?.[h]?.slice(0, 48) ?? "";

  return (
    <div className="grid gap-4">
      <ol className="flex flex-wrap gap-1.5 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="badge" style={{ background: i === step ? "rgba(99,102,241,0.14)" : i < step ? "rgba(16,185,129,0.12)" : "var(--surface-card-header)", color: i === step ? "#4338CA" : i < step ? "#047857" : "var(--text-muted)" }}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {error && <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(220,38,38,0.08)", color: "#B91C1C" }}><XCircle size={17} className="mt-0.5 shrink-0" />{error}</div>}

      {phase.k === "upload" && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-6 py-10 text-center transition hover:opacity-90" style={{ border: "1.5px dashed var(--border-default)", background: "var(--surface-card-header)" }}>
          <FileSpreadsheet size={30} style={{ color: "var(--accent-section)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Choose one CSV with companies and people</span>
          <span className="muted text-xs">Apollo, LinkedIn or your own export · LinkedIn activity columns optional · any number of rows</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="btn btn-primary btn-sm mt-2"><Upload size={14} /> Select file</span>
        </label>
      )}

      {parsed && phase.k !== "upload" && phase.k !== "finished" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{parsed.file.name}</div>
            <div className="muted text-xs">{parsed.rows.length.toLocaleString()} rows · {parsed.headers.length} columns{campaignName && step > 1 ? ` · ${campaignName} · ${senderName}` : ""}</div>
          </div>
          {phase.k !== "importing" && <button className="btn btn-ghost btn-sm" onClick={reset}>Choose another file</button>}
        </div>
      )}

      {phase.k === "campaign" && (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid content-start gap-2">
              <label className="field-label" htmlFor="imp-campaign">ABM Campaign or Segment</label>
              <select id="imp-campaign" className="glass-select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">Choose…</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <NewOption label="campaign" onCreate={async (name) => {
                const r = await createCampaignAction(name);
                if (!r.ok) return r.message;
                setCampaigns((xs) => (xs.some((x) => x.id === r.id) ? xs : [...xs, { id: r.id, name: r.name }]));
                setCampaignId(r.id);
                return null;
              }} />
              <p className="muted text-xs">Applied to every valid record in this file.</p>
            </div>
            <div className="grid content-start gap-2">
              <label className="field-label" htmlFor="imp-sender">LinkedIn Sender Profile</label>
              <select id="imp-sender" className="glass-select" value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                <option value="">Choose…</option>
                {senders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <NewOption label="sender profile" onCreate={async (name) => {
                const r = await createSenderAction(name);
                if (!r.ok) return r.message;
                setSenders((xs) => (xs.some((x) => x.id === r.id) ? xs : [...xs, { id: r.id, name: r.name }]));
                setSenderId(r.id);
                return null;
              }} />
              <p className="muted text-xs">Creates or updates this sender&apos;s journey for each person. People already imported for another sender are reused, never duplicated.</p>
            </div>
          </div>
          <div className="flex justify-end">
            <button className="btn btn-brand" disabled={!campaignId || !senderId} onClick={() => setPhase({ k: "map" })}>Next: map fields <ArrowRight size={15} /></button>
          </div>
        </div>
      )}

      {phase.k === "map" && parsed && analysis && (
        <div className="grid gap-4">
          <p className="secondary text-sm">Map each column once — Company, People and optional LinkedIn activity together. Columns left on <b>Ignore</b> are not stored. This mapping is remembered for files with the same columns.</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Column in your file</th><th>Example value</th><th>Maps to</th></tr></thead>
              <tbody>
                {parsed.headers.map((h) => {
                  const k = mapping[h] as FieldKey | undefined;
                  const dup = k && analysis.duplicates.includes(h);
                  return (
                    <tr key={h}>
                      <td className="strong">{h}</td>
                      <td className="muted max-w-[220px] truncate text-xs" title={sample(h)}>{sample(h) || "—"}</td>
                      <td>
                        <select className="glass-select" style={{ minWidth: 220, borderColor: dup ? "#DC2626" : undefined }} value={k ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} aria-label={`Field for ${h}`}>
                          <option value="">Ignore</option>
                          {GROUPS.map((g) => (
                            <optgroup key={g} label={g}>
                              {IMPORT_FIELDS.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}{f.requirement === "required" ? " *" : f.requirement === "recommended" ? " (recommended)" : ""}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        {dup && <div className="mt-1 text-[0.7rem]" style={{ color: "#B91C1C" }}>Already mapped from another column — this one will be ignored</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {analysis.missingRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(220,38,38,0.08)", color: "#B91C1C" }}>
              <XCircle size={17} className="mt-0.5 shrink-0" /> Map the required field{analysis.missingRequired.length > 1 ? "s" : ""}: {analysis.missingRequired.map((f) => f.label).join(", ")}{analysis.missingRequired.some((f) => f.key === "firstName") ? " (or Full Name)" : ""}.
            </div>
          )}
          {!analysis.missingRequired.length && !Object.values(analysis.mapping).includes("domain") && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(245,158,11,0.1)", color: "#B45309" }}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> No Company Website mapped: companies will be matched by LinkedIn URL or name only. Website is recommended to prevent duplicates.
            </div>
          )}
          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => setPhase({ k: "campaign" })}><ArrowLeft size={15} /> Back</button>
            <button className="btn btn-brand" disabled={analysis.missingRequired.length > 0} onClick={buildPreview}>Validate and preview <ArrowRight size={15} /></button>
          </div>
        </div>
      )}

      {phase.k === "preview" && (
        <div className="grid gap-4">
          {phase.busy || !phase.data ? (
            <div className="flex items-center gap-2 text-sm secondary"><Loader2 size={16} className="spin" /> Validating rows and checking matches…</div>
          ) : (
            <>
              <div className="micro">Companies</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="New companies" value={phase.data.companiesNew} tone="good" />
                <Stat label="Existing (will update)" value={phase.data.companiesExisting} />
              </div>
              <div className="micro">People</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="New people" value={phase.data.peopleNew} tone="good" />
                <Stat label="Existing (will update)" value={phase.data.peopleExisting} />
                <Stat label="Duplicate rows in file" value={phase.data.duplicates} tone={phase.data.duplicates ? "warn" : undefined} />
                <Stat label="Invalid rows" value={phase.data.invalid} tone={phase.data.invalid ? "bad" : undefined} />
              </div>
              <div className="micro">Journeys for {senderName} · {campaignName}</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="New journeys" value={phase.data.journeysNew} tone="good" />
                <Stat label="Existing journeys" value={phase.data.journeysExisting} />
                <Stat label="Rows with LinkedIn activity" value={phase.data.withActivity} />
              </div>
              <p className="muted text-xs">Duplicate rows (same LinkedIn URL, email, or name at the same company) are merged into one person. Existing journeys only receive activity that is new. Without activity columns, new journeys start at <b>Not Contacted</b>.</p>
              {phase.data.sampleErrors.length > 0 && (
                <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(245,158,11,0.1)" }}>
                  <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: "#B45309" }}><AlertTriangle size={14} /> Rows that will be rejected (first {phase.data.sampleErrors.length})</div>
                  <ul className="grid gap-0.5 secondary">{phase.data.sampleErrors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>
                </div>
              )}
              <div className="flex justify-between">
                <button className="btn btn-ghost" onClick={() => setPhase({ k: "map" })}><ArrowLeft size={15} /> Back to mapping</button>
                <button className="btn btn-brand" disabled={phase.data.valid === 0} onClick={run}><Upload size={15} /> Confirm import of {phase.data.valid.toLocaleString()} rows</button>
              </div>
            </>
          )}
        </div>
      )}

      {phase.k === "importing" && (
        <div className="grid gap-3 rounded-2xl p-5" style={{ background: "var(--surface-card-header)" }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}><Loader2 size={16} className="spin" /> {phase.label}…</div>
          <Bar value={phase.done} total={phase.total} label="Progress" />
          <p className="muted text-xs">You can leave this page during step 2 — anything not finished is picked up by the scheduler.</p>
        </div>
      )}

      {phase.k === "finished" && (
        <div className="grid gap-4">
          <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(16,185,129,0.1)", color: "#047857" }}>
            <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
            <span><b>{phase.summary.filename}</b> imported into {campaignName} · {senderName}: {phase.summary.accepted.toLocaleString()} rows saved, {phase.summary.rejected.toLocaleString()} rejected. {phase.summary.processed} compan{phase.summary.processed === 1 ? "y" : "ies"} processed{phase.summary.remaining ? `, ${phase.summary.remaining} left for the scheduler` : ""}.</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="New companies" value={phase.summary.stats.accountsCreated ?? 0} tone="good" />
            <Stat label="Updated companies" value={phase.summary.stats.accountsUpdated ?? 0} />
            <Stat label="New people" value={phase.summary.stats.contactsCreated ?? 0} tone="good" />
            <Stat label="Updated people" value={phase.summary.stats.contactsUpdated ?? 0} />
            <Stat label="New journeys" value={phase.summary.stats.journeysCreated ?? 0} tone="good" />
            <Stat label="Journeys with new activity" value={phase.summary.stats.journeysUpdated ?? 0} />
          </div>
          {phase.summary.research && phase.summary.research.companies > 0 && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "var(--surface-card-header)", border: "1px solid var(--border-subtle)" }}>
              <div className="micro mb-1.5">Import → research</div>
              <ul className="grid gap-1 secondary">
                {phase.summary.research.websitesFound > 0 && <li>Research found <b style={{ color: "var(--text-primary)" }}>{phase.summary.research.websitesFound}</b> missing website{phase.summary.research.websitesFound > 1 ? "s" : ""}, so people there can be verified.</li>}
                {phase.summary.research.websitesMissing > 0 && <li style={{ color: "#B45309" }}>{phase.summary.research.websitesMissing} website{phase.summary.research.websitesMissing > 1 ? "s" : ""} could not be found — add Company Website in the next upload.</li>}
                {phase.summary.research.profilesFilled > 0 && <li>Missing industry, size or country filled for <b style={{ color: "var(--text-primary)" }}>{phase.summary.research.profilesFilled}</b> compan{phase.summary.research.profilesFilled > 1 ? "ies" : "y"} (with sources).</li>}
                <li><b style={{ color: "var(--text-primary)" }}>{phase.summary.research.deepDives}</b> deep-dive research run{phase.summary.research.deepDives === 1 ? "" : "s"}{phase.summary.research.engagedDeepDives ? `, ${phase.summary.research.engagedDeepDives} because someone already replied on LinkedIn` : ""}.</li>
                {phase.summary.research.skippedKnown > 0 && <li>{phase.summary.research.skippedKnown} search{phase.summary.research.skippedKnown > 1 ? "es" : ""} skipped because the file already answered them (tech stack).</li>}
              </ul>
              <p className="muted mt-1.5 text-xs">Open any company → <b>Data → research</b> to see the full mapping.</p>
            </div>
          )}
          {phase.summary.errors.length > 0 && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(245,158,11,0.1)" }}>
              <div className="mb-1 font-semibold" style={{ color: "#B45309" }}>Rejected rows (fix and re-upload — re-uploading is safe)</div>
              <ul className="grid gap-0.5 secondary">{phase.summary.errors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-2">
            <a href={`/people?campaign=${campaignId}&sender=${senderId}`} className="btn btn-primary btn-sm">View people</a>
            <a href="/accounts?sort=recent" className="btn btn-secondary btn-sm">View companies</a>
            <button className="btn btn-secondary btn-sm" onClick={() => { reset(); window.location.reload(); }}>Import another file</button>
          </div>
        </div>
      )}

      <details className="text-xs">
        <summary className="muted cursor-pointer">All fields ({IMPORT_FIELDS.length})</summary>
        <div className="table-wrap mt-2">
          <table className="data">
            <thead><tr><th>Field</th><th>Group</th><th>Requirement</th><th>Notes</th></tr></thead>
            <tbody>
              {IMPORT_FIELDS.map((f) => (
                <tr key={f.key}><td className="strong">{f.label}</td><td>{f.group}</td><td>{f.requirement}</td><td>{f.help}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
