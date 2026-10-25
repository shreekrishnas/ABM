"use client";

// Seller pack editor. Forms for the sections people change most; the full pack as JSON
// for everything else. Problems are shown as you type (same checks the server runs),
// and the save bar lists which sections will change.

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Braces, Check, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { SellerProfile } from "@/lib/seller/types";
import { validatePack } from "@/lib/seller/schema";
import { changedSections, friendlyProblem, sectionLabel } from "@/lib/seller/diff";
import { toast } from "@/components/client";
import { Card, cx } from "@/components/ui";
import { resetPackAction, restorePackAction, savePackAction } from "../actions";

export interface RevisionRow {
  id: string;
  version: string;
  changed: string[];
  note: string | null;
  createdAt: string;
  isReset: boolean;
  facts: number;
  drafts: number;
}

const AUTONOMY: { value: SellerProfile["autonomy"]; label: string; hint: string }[] = [
  { value: "review_all", label: "A person approves every email", hint: "Safest. Every draft waits in Approvals." },
  { value: "auto_t3", label: "T3 emails that pass every check go out", hint: "T1 and T2 still need a person." },
  { value: "auto_all", label: "All emails that pass every check go out", hint: "No person in the loop unless a check fails." },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "item";
const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("grid gap-1.5", className)}>
      <span className="text-[0.8rem] font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
      {children}
      {hint && <span className="muted text-xs">{hint}</span>}
    </label>
  );
}

/** Comma-separated list. Keeps the raw text while typing so trailing commas don't vanish. */
function ListInput({ value, onChange, placeholder, ariaLabel }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => {
    if (toList(text).join("|") !== value.join("|")) setText(value.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <input className="glass-input" value={text} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => { setText(e.target.value); onChange(toList(e.target.value)); }} />;
}

function NumberInput({ value, onChange, ariaLabel, min = 0 }: { value: number | undefined; onChange: (v: number) => void; ariaLabel: string; min?: number }) {
  return <input className="glass-input tnum" type="number" min={min} inputMode="numeric" aria-label={ariaLabel} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? NaN : Math.round(Number(e.target.value)))} />;
}

/** One line per item, with add and remove. */
function LinesEditor({ items, onChange, placeholder, addLabel }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; addLabel: string }) {
  return (
    <div className="grid gap-2">
      {items.map((t, i) => (
        <div key={i} className="flex gap-2">
          <input className="glass-input" value={t} placeholder={placeholder} aria-label={`${placeholder} ${i + 1}`} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn btn-icon" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => onChange([...items, ""])}><Plus size={14} /> {addLabel}</button>
    </div>
  );
}

export function PackEditor({ sellerId, base, builtIn, source, revisions }: { sellerId: string; base: SellerProfile; builtIn: boolean; source: { rejected: string[] | null }; revisions: RevisionRow[] }) {
  const router = useRouter();
  const [pack, setPack] = useState<SellerProfile>(base);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const set = (fn: (d: SellerProfile) => void) =>
    setPack((p) => {
      const d = structuredClone(p);
      fn(d);
      return d;
    });

  const problems = useMemo(() => validatePack(pack), [pack]);
  const changed = useMemo(() => changedSections(base, pack), [base, pack]);
  const dirty = changed.length > 0 || (mode === "json" && json !== JSON.stringify(pack, null, 2));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function openJson() {
    setJson(JSON.stringify(pack, null, 2));
    setJsonError(null);
    setMode("json");
  }

  /** Parse the JSON box into the form. Returns the parsed pack, or null with an error shown. */
  function applyJson(): SellerProfile | null {
    try {
      const p = JSON.parse(json);
      if (typeof p !== "object" || p === null || Array.isArray(p)) throw new Error("The pack must be a JSON object");
      setPack(p);
      setJsonError(null);
      return p;
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  function save() {
    const toSave = mode === "json" ? applyJson() : pack;
    if (!toSave) return;
    const p = validatePack(toSave);
    if (p.length) {
      setServerProblems([]);
      toast({ ok: false, message: `${p.length} problem${p.length === 1 ? "" : "s"} to fix before saving` });
      return;
    }
    if (toSave.autonomy !== base.autonomy && toSave.autonomy !== "review_all" && !window.confirm(`Approval changes to "${AUTONOMY.find((a) => a.value === toSave.autonomy)?.label}". Emails that pass every check will be sent without a person reviewing them. Continue?`)) return;
    start(async () => {
      const r = await savePackAction(sellerId, JSON.stringify(toSave), note);
      setServerProblems(r?.problems ?? []);
      toast(r);
      if (r?.ok) {
        setNote("");
        setMode("form");
        router.refresh();
      }
    });
  }

  function discard() {
    setPack(base);
    setMode("form");
    setServerProblems([]);
  }

  const icp = pack.icp;
  const allProblems = mode === "json" && jsonError ? [`JSON: ${jsonError}`] : [...new Set([...problems, ...serverProblems])];

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 gap-5">
        {source.rejected && (
          <div className="read-surface flex gap-3 rounded-2xl px-4 py-3 text-sm" style={{ border: "1px solid color-mix(in srgb, var(--stop, #DC2626) 35%, transparent)" }} role="alert">
            <AlertTriangle size={18} style={{ color: "var(--stop, #DC2626)" }} className="mt-0.5 shrink-0" aria-hidden />
            <div><b style={{ color: "var(--text-primary)" }}>The latest saved version can&apos;t be used</b>, so runs use the last valid one. Fix and save again: <span className="secondary">{source.rejected.slice(0, 3).join("; ")}</span></div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="seg" role="tablist" aria-label="Editor mode">
            <button type="button" role="tab" aria-selected={mode === "form"} className={cx("btn btn-sm", mode === "form" ? "btn-primary" : "btn-secondary")} onClick={() => (mode === "json" ? applyJson() && setMode("form") : undefined)}>Form</button>{" "}
            <button type="button" role="tab" aria-selected={mode === "json"} className={cx("btn btn-sm", mode === "json" ? "btn-primary" : "btn-secondary")} onClick={() => mode === "form" && openJson()}><Braces size={14} /> Full pack (JSON)</button>
          </div>
          <span className="muted text-xs">{builtIn ? "Using the built-in pack from code" : "Using an edited version"}</span>
        </div>

        {mode === "json" ? (
          <Card title="Full pack" sub="Everything the brain knows about the seller: personas, research questions, industries, products. Check problems on the right before saving.">
            <textarea className="glass-textarea mono w-full text-xs" style={{ minHeight: 560 }} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} aria-label="Seller pack JSON" />
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyJson()}><Check size={14} /> Check JSON</button>
            </div>
          </Card>
        ) : (
          <>
            <Card title="Who to target" sub="Hard rules run before any money is spent on research">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Countries" hint="2-letter codes, comma-separated. Leave empty for any country.">
                  <ListInput ariaLabel="Target countries" value={icp.mustHave?.countries ?? []} placeholder="IN, AE" onChange={(v) => set((d) => { d.icp.mustHave = { ...d.icp.mustHave, countries: v.length ? v.map((c) => c.toUpperCase()) : undefined }; if (!d.icp.mustHave.countries && !d.icp.mustHave.minEmployees) d.icp.mustHave = undefined; })} />
                </Field>
                <Field label="Minimum employees" hint="Companies below this are excluded. Leave empty for no minimum.">
                  <input className="glass-input tnum" type="number" min={1} aria-label="Minimum employees" value={icp.mustHave?.minEmployees ?? ""} onChange={(e) => set((d) => { const n = e.target.value === "" ? undefined : Math.round(Number(e.target.value)); d.icp.mustHave = { ...d.icp.mustHave, minEmployees: n }; if (!d.icp.mustHave.countries && !d.icp.mustHave.minEmployees) d.icp.mustHave = undefined; })} />
                </Field>
                <Field label="Industries" hint="Target list scores industry in the fit; any industry lets research decide.">
                  <select className="glass-select" value={icp.industryMode ?? "targeted"} onChange={(e) => set((d) => { d.icp.industryMode = e.target.value as "targeted" | "any"; })}>
                    <option value="targeted">Target list ({icp.industries.length} industries)</option>
                    <option value="any">Any industry</option>
                  </select>
                </Field>
                <Field label="Primary markets" hint="Full geography points in the fit score.">
                  <ListInput ariaLabel="Primary markets" value={icp.geos.primary} onChange={(v) => set((d) => { d.icp.geos.primary = v.map((c) => c.toUpperCase()); })} />
                </Field>
              </div>
              <div className="micro mb-2 mt-5">Company size in the fit score</div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Full marks from"><NumberInput ariaLabel="Size sweet spot" value={icp.employees.sweetSpot} onChange={(n) => set((d) => { d.icp.employees.sweetSpot = n; })} /></Field>
                <Field label="Strong from"><NumberInput ariaLabel="Size mid" value={icp.employees.mid} onChange={(n) => set((d) => { d.icp.employees.mid = n; })} /></Field>
                <Field label="Some points from"><NumberInput ariaLabel="Size minimum" value={icp.employees.min} onChange={(n) => set((d) => { d.icp.employees.min = n; })} /></Field>
              </div>
              <div className="mt-5 flex items-center gap-2">
                <input id="tiers-by-size" type="checkbox" checked={Boolean(icp.tierBySize)} onChange={(e) => set((d) => { d.icp.tierBySize = e.target.checked ? { T1: 50000, T2: 15000 } : undefined; })} />
                <label htmlFor="tiers-by-size" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Set tiers by company size</label>
                <span className="muted text-xs">Otherwise tiers follow the fit score. Hot buying intent always upgrades to T1.</span>
              </div>
              {icp.tierBySize && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="T1 from (employees)"><NumberInput min={1} ariaLabel="T1 threshold" value={icp.tierBySize.T1} onChange={(n) => set((d) => { d.icp.tierBySize!.T1 = n; })} /></Field>
                  <Field label="T2 from (employees)"><NumberInput min={1} ariaLabel="T2 threshold" value={icp.tierBySize.T2} onChange={(n) => set((d) => { d.icp.tierBySize!.T2 = n; })} /></Field>
                </div>
              )}
            </Card>

            <Card title="Approval" sub="Enforced in code: a check that couldn't run always sends the email to a person">
              <div className="grid gap-2" role="radiogroup" aria-label="Approval">
                {AUTONOMY.map((a) => (
                  <label key={a.value} className={cx("flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3", pack.autonomy === a.value && "ring-2")} style={{ background: "var(--surface-card-header)", ["--tw-ring-color" as string]: "rgba(99,102,241,.35)" }}>
                    <input type="radio" name="autonomy" className="mt-1" checked={pack.autonomy === a.value} onChange={() => set((d) => { d.autonomy = a.value; })} />
                    <span><b className="text-sm" style={{ color: "var(--text-primary)" }}>{a.label}</b><span className="muted block text-xs">{a.hint}</span></span>
                  </label>
                ))}
              </div>
            </Card>

            <Card title="Sender" sub="Shown in every email; the postal address is a legal requirement">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Company"><input className="glass-input" value={pack.sender.company} onChange={(e) => set((d) => { d.sender.company = e.target.value; })} /></Field>
                <Field label="Signed by"><input className="glass-input" value={pack.sender.name} onChange={(e) => set((d) => { d.sender.name = e.target.value; })} /></Field>
                <Field label="Registered postal address" className="md:col-span-2" hint={pack.sender.address.split(",").length < 4 ? "Looks incomplete — use the full registered address (street, city, PIN, country)." : undefined}>
                  <input className="glass-input" value={pack.sender.address} onChange={(e) => set((d) => { d.sender.address = e.target.value; })} />
                </Field>
              </div>
            </Card>

            <Card title="Messaging" sub="The writer leads with a verified fact about the prospect, then uses one of these">
              <div className="grid gap-4">
                <Field label="Call to action"><input className="glass-input" value={pack.messaging.cta} onChange={(e) => set((d) => { d.messaging.cta = e.target.value; })} /></Field>
                <Field label="Default pitch" hint="Used when no use case matches.">
                  <textarea className="glass-textarea" value={pack.messaging.default} onChange={(e) => set((d) => { d.messaging.default = e.target.value; })} />
                </Field>
                <div className="micro mt-1">Pitch per use case</div>
                {pack.useCases.map((u) => (
                  <Field key={u.key} label={u.name} hint={`Pains: ${u.pains}`}>
                    <textarea className="glass-textarea" placeholder="Empty = use the default pitch" value={pack.messaging.byUseCase[u.key] ?? ""} onChange={(e) => set((d) => { if (e.target.value) d.messaging.byUseCase[u.key] = e.target.value; else delete d.messaging.byUseCase[u.key]; })} />
                  </Field>
                ))}
              </div>
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Tone" sub="Passed to the writer and the style check">
                <LinesEditor items={pack.tone} placeholder="Tone rule" addLabel="Add a rule" onChange={(v) => set((d) => { d.tone = v; })} />
              </Card>
              <Card title="Never claim" sub="Checked by code before any email is approved">
                <LinesEditor items={pack.bannedClaims} placeholder="Banned claim" addLabel="Add a claim" onChange={(v) => set((d) => { d.bannedClaims = v; })} />
              </Card>
            </div>

            <Card title="Buying triggers" sub="What research looks for as a reason to reach out now">
              <div className="grid gap-3">
                {pack.triggers.map((t, i) => (
                  <div key={i} className="grid gap-3 rounded-xl p-3.5 md:grid-cols-2" style={{ background: "var(--surface-card-header)" }}>
                    <Field label="Trigger"><input className="glass-input" value={t.label} onChange={(e) => set((d) => {
                      d.triggers[i].label = e.target.value;
                      // A trigger added here gets its key from its name (existing keys never change: stored facts refer to them).
                      if (!base.triggers.some((b) => b.key === t.key)) {
                        const taken = new Set(d.triggers.filter((_, j) => j !== i).map((x) => x.key));
                        let k = slug(e.target.value);
                        for (let n = 2; taken.has(k); n++) k = `${slug(e.target.value)}_${n}`;
                        d.triggers[i].key = k;
                      }
                    })} /></Field>
                    <Field label="Keywords" hint="Comma-separated words that mark this trigger in news."><ListInput ariaLabel={`Keywords for ${t.label}`} value={t.keywords} onChange={(v) => set((d) => { d.triggers[i].keywords = v; })} /></Field>
                    <Field label="Why it matters" className="md:col-span-2"><input className="glass-input" value={t.why} onChange={(e) => set((d) => { d.triggers[i].why = e.target.value; })} /></Field>
                    <button type="button" className="btn btn-ghost btn-sm justify-self-start md:col-span-2" onClick={() => set((d) => { d.triggers.splice(i, 1); })}><Trash2 size={14} /> Remove trigger</button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm justify-self-start" onClick={() => set((d) => {
                  const taken = new Set(d.triggers.map((x) => x.key));
                  let k = "new_trigger";
                  for (let n = 2; taken.has(k); n++) k = `new_trigger_${n}`;
                  d.triggers.push({ key: k, label: "", keywords: [], why: "" });
                })}><Plus size={14} /> Add trigger</button>
              </div>
            </Card>

            <Card title="Proof points" sub="Approved collateral the writer may cite">
              <div className="grid gap-3">
                {pack.proofPoints.map((p, i) => (
                  <div key={i} className="grid gap-2 rounded-xl bg-[var(--surface-card-header)] p-2.5 sm:grid-cols-[1fr_200px_auto] sm:bg-transparent sm:p-0">
                    <input className="glass-input" aria-label={`Proof point ${i + 1}`} value={p.text} placeholder="What you can prove" onChange={(e) => set((d) => { d.proofPoints[i].text = e.target.value; })} />
                    <input className="glass-input" aria-label={`Source ${i + 1}`} value={p.source} placeholder="Source" onChange={(e) => set((d) => { d.proofPoints[i].source = e.target.value; })} />
                    <button type="button" className="btn btn-icon" aria-label="Remove proof point" onClick={() => set((d) => { d.proofPoints.splice(i, 1); })}><Trash2 size={15} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => set((d) => { d.proofPoints.push({ text: "", source: "" }); })}><Plus size={14} /> Add proof point</button>
              </div>
            </Card>
            <p className="muted text-xs">Personas, research questions, industries, products and competitors are edited in <button type="button" className="underline" onClick={openJson}>the full pack</button>.</p>
          </>
        )}
      </div>

      <aside className="grid gap-5 xl:sticky xl:top-4">
        <Card title="Save changes">
          {changed.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">{changed.map((c) => <span key={c} className="chip" style={{ ["--c" as string]: "#4F46E5" }}>{sectionLabel(c)}</span>)}</div>
          ) : (
            <p className="muted mb-3 text-xs">{mode === "json" ? "Check the JSON to see what changes." : "No changes yet."}</p>
          )}
          {allProblems.length > 0 && (
            <ul className="mb-3 grid gap-1 text-xs" role="alert" style={{ color: "var(--stop, #DC2626)" }}>
              {allProblems.slice(0, 8).map((p) => <li key={p}>· {friendlyProblem(p)}</li>)}
              {allProblems.length > 8 && <li>· and {allProblems.length - 8} more</li>}
            </ul>
          )}
          <Field label="What changed and why" hint="Shown in the history.">
            <input className="glass-input" value={note} maxLength={500} placeholder="e.g. Added full postal address" onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-brand flex-1" disabled={pending || !dirty || (mode === "form" && problems.length > 0)} onClick={save}><Save size={15} /> {pending ? "Saving…" : "Save new version"}</button>
            <button type="button" className="btn btn-secondary" disabled={pending || !dirty} onClick={discard}>Discard</button>
          </div>
          <p className="muted mt-3 text-xs">Runs already in progress finish on the version they started with. Facts and drafts record the version that made them.</p>
        </Card>

        <Card title="History" sub={revisions.length ? `${revisions.length} saved version${revisions.length === 1 ? "" : "s"}` : "No edits yet — using the pack in code"} pad>
          <ol className="grid gap-3">
            {revisions.map((r, i) => (
              <li key={r.id} className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "var(--surface-card-header)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="mono" style={{ color: "var(--text-primary)" }}>{r.version}</span>
                  {i === 0 ? <span className="chip" style={{ ["--c" as string]: "#059669" }}>active</span> : (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => { const res = await restorePackAction(r.id); toast(res); if (res?.ok) router.refresh(); })}><RotateCcw size={13} /> Restore</button>
                  )}
                </div>
                <div className="muted mt-0.5"><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>{r.facts + r.drafts > 0 && ` · used for ${r.facts} facts, ${r.drafts} drafts`}</div>
                <div className="secondary mt-1">{r.isReset ? "Back to the built-in pack" : r.changed.map(sectionLabel).join(", ")}</div>
                {r.note && <div className="mt-1 italic secondary">“{r.note}”</div>}
              </li>
            ))}
          </ol>
          {!builtIn && (
            <button type="button" className="btn btn-ghost btn-sm mt-3" disabled={pending} onClick={() => window.confirm("Go back to the built-in pack from code? Your edits stay in the history and can be restored.") && start(async () => { const res = await resetPackAction(sellerId); toast(res); if (res?.ok) router.refresh(); })}><RotateCcw size={13} /> Reset to built-in</button>
          )}
        </Card>
      </aside>
    </div>
  );
}
