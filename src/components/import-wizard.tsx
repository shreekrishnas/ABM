"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { analyzeHeaders, IMPORT_FIELDS, validateRow, type HeaderAnalysis } from "@/lib/import/fields";
import { finishImportAction, importChunkAction, processImportAction, startImportAction } from "@/app/actions";

const CHUNK = 250;

type Phase =
  | { k: "idle" }
  | { k: "preview"; file: File; headers: string[]; rows: Record<string, string>[]; analysis: HeaderAnalysis; invalid: number; sampleErrors: { row: number; error: string }[] }
  | { k: "uploading"; done: number; total: number }
  | { k: "processing"; batchId: string; done: number; total: number }
  | { k: "finished"; summary: Summary }
  | { k: "error"; message: string };

interface Summary {
  filename: string;
  accepted: number;
  rejected: number;
  errors: { row: number; error: string }[];
  stats: Record<string, number>;
  processed: number;
  remaining: number;
}

function Bar({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs"><span className="secondary">{label}</span><span className="tnum font-semibold" style={{ color: "var(--text-primary)" }}>{value} / {total}</span></div>
      <div className="track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function ImportWizard() {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase({ k: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setPhase({ k: "error", message: "Please choose a .csv file (Excel: File → Save As → CSV UTF-8)." });
    if (file.size > 50 * 1024 * 1024) return setPhase({ k: "error", message: "File is larger than 50 MB. Split it into smaller files." });
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        const rows = res.data;
        if (!rows.length) return setPhase({ k: "error", message: "No data rows found in this file." });
        const analysis = analyzeHeaders(headers);
        // Same validation the server applies, so the preview matches the outcome.
        let invalid = 0;
        const sampleErrors: { row: number; error: string }[] = [];
        rows.forEach((r, i) => {
          const v = validateRow(r, analysis.mapping);
          if (!v.ok) {
            invalid++;
            if (sampleErrors.length < 8) sampleErrors.push({ row: i + 2, error: v.error });
          }
        });
        setPhase({ k: "preview", file, headers, rows, analysis, invalid, sampleErrors });
      },
      error: (err) => setPhase({ k: "error", message: `Could not read the file: ${err.message}` }),
    });
  };

  const run = async () => {
    if (phase.k !== "preview") return;
    const { file, headers, rows } = phase;
    try {
      const start = await startImportAction({ filename: file.name, rows: rows.length, headers });
      if (!start.ok) return setPhase({ k: "error", message: start.message });
      let accepted = 0;
      let rejected = 0;
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        setPhase({ k: "uploading", done: i, total: rows.length });
        const res = await importChunkAction(start.batchId, headers, rows.slice(i, i + CHUNK), i);
        if (!res.ok) throw new Error(res.message);
        accepted += res.accepted;
        rejected += res.rejected;
        if (errors.length < 100) errors.push(...res.errors);
      }
      const fin = await finishImportAction(start.batchId);
      let remaining = fin.toProcess;
      let processed = 0;
      // Process changed accounts in small server calls until the queue is empty.
      while (remaining > 0) {
        setPhase({ k: "processing", batchId: start.batchId, done: fin.toProcess - remaining, total: fin.toProcess });
        const p = await processImportAction(start.batchId);
        processed += p.processed;
        if (p.processed === 0 && p.remaining >= remaining) break; // stuck: leave the rest for the scheduler
        remaining = p.remaining;
      }
      setPhase({ k: "finished", summary: { filename: file.name, accepted, rejected, errors, stats: fin.stats as unknown as Record<string, number>, processed, remaining } });
    } catch (e) {
      setPhase({ k: "error", message: e instanceof Error ? e.message : "Upload failed" });
    }
  };

  return (
    <div className="grid gap-4">
      {(phase.k === "idle" || phase.k === "error") && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-6 py-10 text-center transition hover:opacity-90" style={{ border: "1.5px dashed var(--border-default)", background: "var(--surface-card-header)" }}>
          <FileSpreadsheet size={30} style={{ color: "var(--accent-section)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Choose this week&apos;s CSV</span>
          <span className="muted text-xs">Companies and prospects using the template columns · any number of rows</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="btn btn-primary btn-sm mt-2"><Upload size={14} /> Select file</span>
        </label>
      )}

      {phase.k === "error" && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(220,38,38,0.08)", color: "#B91C1C" }}><XCircle size={17} className="mt-0.5 shrink-0" />{phase.message}</div>
      )}

      {phase.k === "preview" && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{phase.file.name}</div>
              <div className="muted text-xs">{phase.rows.length.toLocaleString()} rows · {phase.headers.length} columns</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={reset}>Choose another file</button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}>
              <div className="micro mb-1.5">Accepted columns</div>
              <div className="flex flex-wrap gap-1.5">{phase.analysis.recognized.map((r) => <span key={r.header} className="badge" style={{ background: "rgba(16,185,129,0.12)", color: "#047857" }} title={r.header !== r.field.label ? `"${r.header}" → ${r.field.label}` : undefined}>{r.field.label}</span>)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}>
              <div className="micro mb-1.5">Ignored (not in template)</div>
              {phase.analysis.ignored.length + phase.analysis.duplicates.length === 0 ? <span className="muted text-xs">None</span> : (
                <div className="flex flex-wrap gap-1.5">{[...phase.analysis.ignored, ...phase.analysis.duplicates].map((h) => <span key={h} className="badge" style={{ background: "rgba(100,116,139,0.12)", color: "#475569" }}>{h}</span>)}</div>
              )}
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}>
              <div className="micro mb-1.5">Rows</div>
              <div className="text-sm"><b style={{ color: "#047857" }}>{(phase.rows.length - phase.invalid).toLocaleString()}</b> <span className="secondary">valid</span> · <b style={{ color: phase.invalid ? "#B91C1C" : undefined }}>{phase.invalid.toLocaleString()}</b> <span className="secondary">will be rejected</span></div>
            </div>
          </div>

          {phase.analysis.missingRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(220,38,38,0.08)", color: "#B91C1C" }}>
              <XCircle size={17} className="mt-0.5 shrink-0" />
              Missing required column{phase.analysis.missingRequired.length > 1 ? "s" : ""}: {phase.analysis.missingRequired.map((f) => f.label).join(", ")}. Add {phase.analysis.missingRequired.length > 1 ? "them" : "it"} (or download the template) and choose the file again.
            </div>
          )}

          {phase.sampleErrors.length > 0 && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(245,158,11,0.1)" }}>
              <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: "#B45309" }}><AlertTriangle size={14} /> Rows that will be rejected (first {phase.sampleErrors.length})</div>
              <ul className="grid gap-0.5 secondary">{phase.sampleErrors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>
            </div>
          )}

          <div className="flex justify-end">
            <button className="btn btn-brand" disabled={phase.analysis.missingRequired.length > 0 || phase.invalid === phase.rows.length} onClick={run}>
              <Upload size={15} /> Import {(phase.rows.length - phase.invalid).toLocaleString()} rows and update automatically
            </button>
          </div>
        </div>
      )}

      {phase.k === "uploading" && (
        <div className="grid gap-3 rounded-2xl p-5" style={{ background: "var(--surface-card-header)" }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}><Loader2 size={16} className="spin" /> Saving rows (step 1 of 2)…</div>
          <Bar value={phase.done} total={phase.total} label="Rows validated and saved" />
        </div>
      )}

      {phase.k === "processing" && (
        <div className="grid gap-3 rounded-2xl p-5" style={{ background: "var(--surface-card-header)" }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}><Loader2 size={16} className="spin" /> Running the pipeline on new and changed accounts (step 2 of 2)…</div>
          <Bar value={phase.done} total={phase.total} label="Accounts processed" />
          <p className="muted text-xs">You can leave this page — anything not finished is picked up by the scheduler.</p>
        </div>
      )}

      {phase.k === "finished" && (
        <div className="grid gap-4">
          <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(16,185,129,0.1)", color: "#047857" }}>
            <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
            <span><b>{phase.summary.filename}</b> imported: {phase.summary.accepted.toLocaleString()} rows saved, {phase.summary.rejected.toLocaleString()} rejected. {phase.summary.processed} account{phase.summary.processed === 1 ? "" : "s"} processed automatically{phase.summary.remaining ? `, ${phase.summary.remaining} left for the scheduler` : ""}.</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["New accounts", phase.summary.stats.accountsCreated],
              ["Updated accounts", phase.summary.stats.accountsUpdated],
              ["New contacts", phase.summary.stats.contactsCreated],
              ["Updated contacts", phase.summary.stats.contactsUpdated],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-xl p-3" style={{ background: "var(--surface-card-header)" }}>
                <div className="micro">{l}</div>
                <div className="display-num mt-1 text-2xl tnum">{(v as number) ?? 0}</div>
              </div>
            ))}
          </div>
          <p className="muted text-xs">Unchanged: {phase.summary.stats.accountsUnchanged ?? 0} accounts, {phase.summary.stats.contactsUnchanged ?? 0} contacts — not re-processed, so no extra spend.{phase.summary.stats.skippedErased ? ` ${phase.summary.stats.skippedErased} erased person(s) skipped.` : ""}</p>
          {phase.summary.errors.length > 0 && (
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(245,158,11,0.1)" }}>
              <div className="mb-1 font-semibold" style={{ color: "#B45309" }}>Rejected rows (fix and re-upload — re-uploading is safe)</div>
              <ul className="grid gap-0.5 secondary">{phase.summary.errors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-2">
            <a href="/accounts?sort=recent" className="btn btn-primary btn-sm">View accounts</a>
            <button className="btn btn-secondary btn-sm" onClick={() => { reset(); window.location.reload(); }}>Import another file</button>
          </div>
        </div>
      )}

      <details className="text-xs">
        <summary className="muted cursor-pointer">Template columns ({IMPORT_FIELDS.length})</summary>
        <div className="table-wrap mt-2">
          <table className="data">
            <thead><tr><th>Column</th><th>Required</th><th>Also accepted as</th><th>Notes</th></tr></thead>
            <tbody>
              {IMPORT_FIELDS.map((f) => (
                <tr key={f.key}><td className="strong">{f.label}</td><td>{f.required ? "Yes" : "—"}</td><td className="muted">{f.aliases.filter((a) => a !== f.label.toLowerCase()).slice(0, 4).join(", ")}</td><td>{f.help}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
