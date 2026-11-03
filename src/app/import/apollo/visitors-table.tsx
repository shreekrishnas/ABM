"use client";

// Website visitor companies: pick some, enrich them with Apollo, then either download them as
// Excel or add them to the pipeline. The two actions are independent.

import { Fragment, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Download, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "@/components/client";
import { enrichVisitorsAction, importVisitorsAction, previewVisitorImportAction } from "./actions";
import type { ImportPreviewItem } from "@/lib/web/visitor-prospects";

export interface VisitorRow {
  key: string;
  name: string;
  domain: string | null;
  visits: number;
  lastVisit: string;
  pages: string[];
  inPipeline: boolean;
  customer: boolean;
  status: string | null;
  message: string | null;
  enrichedAt: string | null;
  importedAt: string | null;
  prospects: { name: string; title: string; linkedin: string; email: string }[];
}

const STATUS: Record<string, { word: string; tone: string }> = {
  found: { word: "Prospects found", tone: "var(--success)" },
  no_prospects: { word: "No one in target roles", tone: "var(--warning)" },
  no_match: { word: "Not found in Apollo", tone: "var(--warning)" },
  failed: { word: "Apollo failed", tone: "var(--danger)" },
  not_connected: { word: "Apollo not connected", tone: "var(--danger)" },
};

const CHECK_WORD: Record<ImportPreviewItem["check"], string> = { eligible: "Eligible", customer: "Existing customer", in_pipeline: "Already in pipeline", review: "Needs review" };

export function VisitorsTable({ rows, range }: { rows: VisitorRow[]; range: { from: string; to: string } }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, start] = useTransition();
  const [preview, setPreview] = useState<ImportPreviewItem[] | null>(null);
  const all = rows.length > 0 && selected.size === rows.length;
  const keys = useMemo(() => rows.filter((r) => selected.has(r.key)).map((r) => r.key), [rows, selected]);

  const toggle = (k: string, set: Set<string>, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setter(n);
  };

  const enrich = (force: boolean) => start(async () => toast(await enrichVisitorsAction(keys, range, force)));
  const download = () => {
    const q = new URLSearchParams({ from: range.from, to: range.to });
    for (const k of keys) q.append("k", k);
    window.location.href = `/import/apollo/export?${q}`;
  };
  const openImport = () => start(async () => setPreview(await previewVisitorImportAction(keys, range)));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="secondary text-sm">{selected.size ? `${selected.size} of ${rows.length} selected` : `${rows.length} companies`}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn btn-secondary" disabled={!keys.length || busy} onClick={() => enrich(false)} title="Find 1–2 people in your target roles at each selected company">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Enrich with Apollo
          </button>
          <button className="btn btn-secondary" disabled={!keys.length} onClick={download} title="Selected companies and their prospects, in the CSV import's columns">
            <Download size={15} /> Download Excel
          </button>
          <button className="btn btn-primary" disabled={!keys.length || busy} onClick={openImport}>
            <Upload size={15} /> Add Selected to ABM Pipeline
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.key)))} /></th>
              <th>Company</th>
              <th className="text-right">Visits</th>
              <th>Last visit</th>
              <th>Apollo prospects</th>
              <th>In ABM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = r.status ? STATUS[r.status] : null;
              const isOpen = open.has(r.key);
              return (
                <Fragment key={r.key}>
                  <tr>
                    <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.key)} onChange={() => toggle(r.key, selected, setSelected)} /></td>
                    <td>
                      <div className="font-medium">{r.name}{r.customer && <span className="chip ml-2">Customer</span>}</div>
                      <div className="secondary text-xs">{r.domain ?? "No website known"}{r.pages.length ? ` · ${r.pages.slice(0, 2).join(" · ")}` : ""}</div>
                    </td>
                    <td className="text-right tnum">{r.visits}</td>
                    <td className="tnum">{r.lastVisit}</td>
                    <td>
                      {st ? (
                        <button className="flex items-center gap-1 text-left text-sm" onClick={() => toggle(r.key, open, setOpen)} aria-expanded={isOpen}>
                          {r.prospects.length ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                          <span style={{ color: st.tone }}>{r.status === "found" ? `${r.prospects.length} prospect${r.prospects.length === 1 ? "" : "s"}` : st.word}</span>
                        </button>
                      ) : (
                        <span className="secondary text-sm">Not enriched</span>
                      )}
                      {r.message && r.status !== "found" && <div className="secondary text-xs">{r.message}</div>}
                    </td>
                    <td className="text-sm">{r.importedAt ? `Added ${r.importedAt}` : r.inPipeline ? "Yes" : <span className="secondary">No</span>}</td>
                  </tr>
                  {isOpen && r.prospects.length > 0 && (
                    <tr>
                      <td />
                      <td colSpan={5}>
                        <ul className="grid gap-1 text-sm">
                          {r.prospects.map((p) => (
                            <li key={p.linkedin || p.name}>
                              <span className="font-medium">{p.name}</span>
                              {p.title && <span className="secondary"> · {p.title}</span>}
                              {p.email && <span className="secondary"> · {p.email}</span>}
                              {p.linkedin && <> · <a className="link" href={p.linkedin} target="_blank" rel="noreferrer">LinkedIn</a></>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {preview && <ImportDialog items={preview} range={range} onClose={() => setPreview(null)} onDone={() => { setPreview(null); setSelected(new Set()); }} />}
    </>
  );
}

function ImportDialog({ items, range, onClose, onDone }: { items: ImportPreviewItem[]; range: { from: string; to: string }; onClose: () => void; onDone: () => void }) {
  const [exclude, setExclude] = useState(true);
  // Only clearly new companies start ticked; customers, existing ones and unverified ones wait for a person.
  const [picked, setPicked] = useState<Set<string>>(new Set(items.filter((i) => i.check === "eligible").map((i) => i.key)));
  const [busy, start] = useTransition();
  const count = (c: ImportPreviewItem["check"]) => items.filter((i) => i.check === c).length;
  const chosen = items.filter((i) => picked.has(i.key) && !(exclude && i.check === "customer"));

  const run = () =>
    start(async () => {
      const r = await importVisitorsAction(chosen.map((i) => i.key), range, exclude);
      toast(r);
      if (r?.ok) onDone();
    });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-modal" role="dialog" aria-modal="true" aria-label="Confirm ABM pipeline import" style={{ maxWidth: 720 }}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Confirm ABM pipeline import</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="secondary">Companies selected</dt><dd className="tnum font-semibold">{items.length}</dd></div>
          <div><dt className="secondary">Existing customers</dt><dd className="tnum font-semibold">{count("customer")}</dd></div>
          <div><dt className="secondary">Already in ABM pipeline</dt><dd className="tnum font-semibold">{count("in_pipeline")}</dd></div>
          <div><dt className="secondary">Need review</dt><dd className="tnum font-semibold">{count("review")}</dd></div>
          <div><dt className="secondary">Eligible</dt><dd className="tnum font-semibold">{count("eligible")}</dd></div>
          <div><dt className="secondary">Will be added</dt><dd className="tnum font-semibold">{chosen.length}</dd></div>
        </dl>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> Exclude existing customers (recommended)
        </label>
        <div className="mb-4 max-h-80 overflow-y-auto">
          <table className="data compact">
            <thead><tr><th style={{ width: 32 }} /><th>Company</th><th>Check</th><th>Why</th></tr></thead>
            <tbody>
              {items.map((i) => {
                const blocked = exclude && i.check === "customer";
                return (
                  <tr key={i.key} style={blocked ? { opacity: 0.55 } : undefined}>
                    <td><input type="checkbox" aria-label={`Include ${i.name}`} disabled={blocked} checked={!blocked && picked.has(i.key)} onChange={() => { const n = new Set(picked); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); setPicked(n); }} /></td>
                    <td><div className="font-medium">{i.name}</div><div className="secondary text-xs">{i.domain ?? "No website"}</div></td>
                    <td className="text-sm">{CHECK_WORD[i.check]}</td>
                    <td className="secondary text-xs">{i.reason}{i.check === "in_pipeline" ? " — ticking it adds only new prospects; nothing is duplicated" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen.length || busy} onClick={run}>
            {busy && <Loader2 size={15} className="animate-spin" />} Add {chosen.length} eligible compan{chosen.length === 1 ? "y" : "ies"} to pipeline
          </button>
        </div>
      </div>
    </div>
  );
}
