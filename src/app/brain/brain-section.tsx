"use client";

import { useState, useTransition, useId } from "react";
import { Check, Loader2, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "@/components/client";
import type { BrainField, BrainItem, BrainSection as Spec } from "@/lib/seller/brain";
import { suggestMatchWordsAction, estimateTargetingAction, saveBrainSectionAction, suggestBrainAction } from "./actions";

const blank = (fields: BrainField[]): BrainItem => Object.fromEntries(fields.map((f) => [f.key, f.kind === "list" || f.kind === "lines" ? [] : f.kind === "bool" ? false : f.kind === "number" ? null : f.kind === "select" ? f.options?.[0]?.value ?? "" : ""]));
const summary = (it: BrainItem, fields: BrainField[]) => {
  const first = fields.find((f) => f.kind === "text" || f.kind === "select" || f.kind === "long");
  const v = first ? it[first.key] : "";
  const label = first?.kind === "select" ? first.options?.find((o) => o.value === v)?.label : v;
  return String(label ?? "").trim() || "Untitled";
};

function Input({ field, value, onChange, id, hintId }: { field: BrainField; value: BrainItem[string]; onChange: (v: BrainItem[string]) => void; id: string; hintId?: string }) {
  const a = { id, "aria-describedby": hintId, "aria-required": field.need === "research" ? true : undefined } as const;
  if (field.kind === "long") return <textarea {...a} className="glass-input br-area" rows={3} value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  if (field.kind === "lines") return <textarea {...a} className="glass-input br-area" rows={3} value={Array.isArray(value) ? value.join("\n") : String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value.split("\n"))} onBlur={(e) => onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />;
  if (field.kind === "list") return <input {...a} className="glass-input" value={Array.isArray(value) ? value.join(", ") : String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trimStart()))} onBlur={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />;
  if (field.kind === "number") return <input {...a} className="glass-input tnum" type="number" inputMode="numeric" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
  if (field.kind === "bool") return <span className="br-check"><input {...a} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> Yes</span>;
  if (field.kind === "select") return <select {...a} className="glass-input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>{field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return <input {...a} className="glass-input" value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Fields({ fields, item, onChange }: { fields: BrainField[]; item: BrainItem; onChange: (it: BrainItem) => void }) {
  const base = useId();
  return (
    <div className="br-fields">
      {fields.map((f) => {
        const id = `${base}-${f.key}`;
        const hintId = f.hint ? `${id}-hint` : undefined;
        return (
          <div key={f.key} className={`br-field${f.kind === "long" || f.kind === "lines" ? " wide" : ""}`}>
            <label htmlFor={id}>{f.label}{f.need && <em className={`br-need ${f.need}`}>{f.need === "research" ? "Required" : "Needed for emails"}</em>}</label>
            <Input field={f} id={id} hintId={hintId} value={item[f.key]} onChange={(v) => onChange({ ...item, [f.key]: v })} />
            {f.hint && <small id={hintId}>{f.hint}</small>}
          </div>
        );
      })}
    </div>
  );
}

/** One brain section: edit, add, remove, replace; AI fill suggests items a person accepts or skips. */
export function BrainSection({ clientId, spec, initial, canEdit }: { clientId: string; spec: Spec; initial: BrainItem[]; canEdit: boolean }) {
  const [items, setItems] = useState<BrainItem[]>(spec.single ? (initial.length ? initial : [blank(spec.fields)]) : initial);
  const [open, setOpen] = useState<number | null>(spec.single ? 0 : null);
  const [dirty, setDirty] = useState(false);
  const [suggestions, setSuggestions] = useState<BrainItem[]>([]);
  const [saving, startSave] = useTransition();
  const [thinking, startThink] = useTransition();
  const edit = (next: BrainItem[]) => { setItems(next); setDirty(true); };

  const save = () => startSave(async () => {
    const r = await saveBrainSectionAction(clientId, spec.key, items);
    toast(r);
    if (r?.ok) setDirty(false);
  });
  const fill = () => startThink(async () => {
    const r = await suggestBrainAction(clientId, spec.key);
    if (!r.ok) return toast({ ok: false, message: r.message });
    setSuggestions(r.items);
    toast({ ok: true, message: `${r.items.length} suggestion${r.items.length === 1 ? "" : "s"} below: accept or skip each` });
  });
  const accept = (s: BrainItem, i: number) => {
    if (spec.single) {
      const cur = items[0] ?? blank(spec.fields);
      const merged = Object.fromEntries(spec.fields.map((f) => {
        const old = cur[f.key];
        const empty = old == null || old === "" || (Array.isArray(old) && !old.length);
        return [f.key, empty ? s[f.key] : old];
      })) as BrainItem;
      edit([merged]);
    } else edit([...items, s]);
    setSuggestions(suggestions.filter((_, j) => j !== i));
  };

  return (
    <section className="br-card" id={`brain-${spec.key}`}>
      <header className="br-head">
        <div className="min-w-0">
          <h2>{spec.label}{!spec.single && <span className="br-count tnum">{items.length}</span>}</h2>
          <p>{spec.help}</p>
        </div>
        {canEdit && (
          <button type="button" className="br-ai" onClick={fill} disabled={thinking} title="Suggest items from the website and uploaded files">
            {thinking ? <Loader2 size={15} className="lg-spin" /> : <Sparkles size={14} />} {spec.single ? "Fill" : "Suggest"}
          </button>
        )}
      </header>

      {spec.single ? (
        <div className="br-body"><Fields fields={spec.fields} item={items[0]} onChange={(it) => canEdit && edit([it])} /></div>
      ) : (
        <ul className="br-list">
          {items.length === 0 && <li className="br-empty">Nothing here yet. Add one, or let the AI suggest from the website and files.</li>}
          {items.map((it, i) => (
            <li key={i} className={`br-item${open === i ? " open" : ""}`}>
              <div className="br-item-row">
                <button type="button" className="br-item-title" onClick={() => setOpen(open === i ? null : i)}>{summary(it, spec.fields)}</button>
                {canEdit && <button type="button" className="br-icon" aria-label="Remove" title="Remove" onClick={() => { edit(items.filter((_, j) => j !== i)); setOpen(null); }}><Trash2 size={15} /></button>}
              </div>
              {open === i && <Fields fields={spec.fields} item={it} onChange={(next) => canEdit && edit(items.map((x, j) => (j === i ? next : x)))} />}
              {open === i && canEdit && spec.key === "industries" && <MatchWords clientId={clientId} item={it} onWords={(words) => edit(items.map((x, j) => (j === i ? { ...x, match: [...new Set([...(Array.isArray(x.match) ? x.match : []), ...words])] } : x)))} />}
            </li>
          ))}
        </ul>
      )}

      {spec.key === "targeting" && <ImpactEstimate clientId={clientId} item={items[0]} />}

      {suggestions.length > 0 && (
        <div className="br-sugg">
          <div className="br-sugg-head"><Sparkles size={14} /> AI suggestions <span>from the website and files: check before saving</span>
            {!spec.single && <button type="button" className="br-link" onClick={() => { edit([...items, ...suggestions]); setSuggestions([]); }}>Accept all</button>}
          </div>
          {suggestions.map((sg, i) => (
            <div key={i} className="br-sugg-item">
              <div className="min-w-0 flex-1">
                <b>{summary(sg, spec.fields)}</b>
                <span>{spec.fields.slice(1).map((f) => (Array.isArray(sg[f.key]) ? (sg[f.key] as string[]).join(", ") : String(sg[f.key] ?? ""))).filter(Boolean).join(" · ").slice(0, 220)}</span>
              </div>
              <button type="button" className="br-icon ok" aria-label="Accept" title={spec.single ? "Fill the empty fields" : "Add to the list"} onClick={() => accept(sg, i)}><Check size={15} /></button>
              <button type="button" className="br-icon" aria-label="Skip" title="Skip" onClick={() => setSuggestions(suggestions.filter((_, j) => j !== i))}><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <footer className="br-foot">
          {!spec.single && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { edit([...items, blank(spec.fields)]); setOpen(items.length); }}><Plus size={14} /> Add</button>}
          {dirty && <span className="br-dirty">Unsaved changes</span>}
          <span className="ml-auto flex gap-2">
            {dirty && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setItems(spec.single ? (initial.length ? initial : [blank(spec.fields)]) : initial); setDirty(false); setSuggestions([]); }}><RotateCcw size={14} /> Discard</button>}
            <button type="button" className={`btn btn-sm ${dirty ? "btn-primary" : "btn-secondary"}`} disabled={!dirty || saving} onClick={save}>{saving ? <Loader2 size={14} className="lg-spin" /> : <Check size={14} />} Save</button>
          </span>
        </footer>
      )}
    </section>
  );
}

/** Optional, rough: how the edited rule would sort the companies already in the app. Not a forecast. */
function ImpactEstimate({ clientId, item }: { clientId: string; item: BrainItem }) {
  const [r, setR] = useState<{ now: number; next: number; total: number } | null>(null);
  const [busy, start] = useTransition();
  return (
    <details className="br-impact">
      <summary>Rough impact estimate <span>optional · not recommended for decisions</span></summary>
      <p>Counts only companies already in the app with a known country and size. It can&apos;t tell you how many exist in the market.</p>
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => start(async () => { const x = await estimateTargetingAction(clientId, item); if (x.ok) setR(x); else toast({ ok: false, message: x.message }); })}>
        {busy ? <Loader2 size={14} className="lg-spin" /> : null} Estimate
      </button>
      {r && <p className="tnum"><b>{r.now}</b> of {r.total} pass the saved rule · <b>{r.next}</b> would pass this one</p>}
    </details>
  );
}

function MatchWords({ clientId, item, onWords }: { clientId: string; item: BrainItem; onWords: (w: string[]) => void }) {
  const [busy, start] = useTransition();
  return (
    <button type="button" className="br-ai br-ai-sm" disabled={busy} onClick={() => start(async () => {
      const r = await suggestMatchWordsAction(clientId, String(item.label ?? ""));
      if (!r.ok) return toast({ ok: false, message: r.message });
      onWords(r.words);
      toast({ ok: true, message: `${r.words.length} match words added: remove any that don't fit, then Save` });
    })}>
      {busy ? <Loader2 size={14} className="lg-spin" /> : <Sparkles size={14} />} AI suggest match words
    </button>
  );
}
