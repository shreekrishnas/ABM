"use client";

// The filter panel and search: every change updates the URL, so a filtered list can be shared
// or bookmarked, and the server renders exactly that list.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { FilterBar, FormField } from "@/components/kit";

type Opt = { value: string; label: string; n?: number };
export type FilterDef = { key: string; label: string; any: string; options: Opt[] };

function useParams() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    next.delete("page");
    start(() => router.replace(`${path}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  return { sp, set, pending };
}

export function FilterPanel({ filters }: { filters: FilterDef[] }) {
  const { sp, set, pending } = useParams();
  const [intent, setIntent] = useState(Number(sp.get("intent") ?? 0));
  useEffect(() => setIntent(Number(sp.get("intent") ?? 0)), [sp]);
  const active = filters.some((f) => sp.get(f.key)) || Number(sp.get("intent") ?? 0) > 0;
  const [open, setOpen] = useState(false);
  const n = filters.filter((f) => sp.get(f.key)).length + (Number(sp.get("intent") ?? 0) > 0 ? 1 : 0);
  return (
    <aside className={`dir-filters${pending ? " busy" : ""}${open ? " open" : ""}`} aria-label="Filters">
      <div className="dir-fh">
        <button type="button" className="dir-ftoggle" aria-expanded={open} onClick={() => setOpen(!open)}><SlidersHorizontal size={14} /> Filters{n ? ` · ${n}` : ""}</button>
        <b className="dir-ftitle">Filters</b>
        {active && <button type="button" className="dir-clear" onClick={() => set(Object.fromEntries([...filters.map((f) => [f.key, null]), ["intent", null]]))}>Clear all</button>}
      </div>
      {filters.map((f) => (
        <label key={f.key} className="dir-f">
          <span>{f.label}</span>
          <select className="glass-select" value={sp.get(f.key) ?? ""} onChange={(e) => set({ [f.key]: e.target.value || null })} disabled={!f.options.length}>
            <option value="">{f.any}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.n != null ? ` (${o.n})` : ""}</option>)}
          </select>
        </label>
      ))}
      <label className="dir-f">
        <span>Minimum intent · <b className="tnum">{intent}</b></span>
        <input type="range" min={0} max={100} step={5} value={intent} onChange={(e) => setIntent(Number(e.target.value))} onPointerUp={() => set({ intent: intent ? String(intent) : null })} onKeyUp={() => set({ intent: intent ? String(intent) : null })} className="dir-range" style={{ ["--v" as string]: `${intent}%` }} />
      </label>
    </aside>
  );
}

export function SearchBox() {
  const { sp, set } = useParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set({ q: q.trim() || null }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="dir-search">
      <Search size={15} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company or domain…" aria-label="Search company or domain" />
      {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><X size={14} /></button>}
    </div>
  );
}

/** Removable chips for the filters in use. */
export function ActiveChips({ chips }: { chips: { key: string; label: string }[] }) {
  const { set } = useParams();
  if (!chips.length) return null;
  return (
    <div className="dir-chips">
      {chips.map((c) => <button key={c.key} type="button" onClick={() => set({ [c.key]: null })}>{c.label}<X size={12} /></button>)}
    </div>
  );
}

/** Select all on the page for the bulk bar. */
export function SelectAllBox() {
  return <input type="checkbox" aria-label="Select all on this page" onChange={(e) => document.querySelectorAll<HTMLInputElement>("input[name=ids]").forEach((c) => (c.checked = e.target.checked))} />;
}

/**
 * Companies filter row (kit FilterBar): search grows, tier and view stay inline, everything else
 * is in the drawer. All state lives in the URL.
 */
export function CompanyFilterBar({ filters, total, view }: { filters: FilterDef[]; total: number; view: "table" | "map" }) {
  const { sp, set } = useParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [intent, setIntent] = useState(Number(sp.get("intent") ?? 0));
  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set({ q: q.trim() || null }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const drawerKeys = filters.filter((f) => f.key !== "tier");
  const active = drawerKeys.filter((f) => sp.get(f.key)).length + (Number(sp.get("intent") ?? 0) > 0 ? 1 : 0);
  const tier = sp.get("tier") ?? "";
  const seg = (items: { v: string; l: string }[], cur: string, onPick: (v: string) => void, label: string) => (
    <div className="k-seg" role="group" aria-label={label}>{items.map((i) => <button key={i.v} type="button" aria-pressed={cur === i.v} onClick={() => onPick(i.v)}>{i.l}</button>)}</div>
  );
  return (
    <FilterBar
      search={{ value: q, onChange: setQ, placeholder: "Search company or domain…" }}
      inline={<>
        {seg([{ v: "", l: "All tiers" }, { v: "T1", l: "T1" }, { v: "T2", l: "T2" }, { v: "T3", l: "T3" }], tier, (v) => set({ tier: v || null }), "Tier")}
        {seg([{ v: "table", l: "Table" }, { v: "map", l: "Map" }], view, (v) => set({ view: v === "table" ? null : v }), "View")}
      </>}
      activeCount={active}
      resultCount={total}
      onClear={() => set(Object.fromEntries([...drawerKeys.map((f) => [f.key, null]), ["intent", null]]))}
      drawer={<>
        {drawerKeys.map((f) => (
          <FormField key={f.key} label={f.label}>
            <select className="glass-select" value={sp.get(f.key) ?? ""} onChange={(e) => set({ [f.key]: e.target.value || null })} disabled={!f.options.length}>
              <option value="">{f.any}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.n != null ? ` (${o.n})` : ""}</option>)}
            </select>
          </FormField>
        ))}
        <FormField label={`Minimum intent: ${intent}`}>
          <input type="range" min={0} max={100} step={5} value={intent} onChange={(e) => setIntent(Number(e.target.value))} onPointerUp={() => set({ intent: intent ? String(intent) : null })} onKeyUp={() => set({ intent: intent ? String(intent) : null })} className="dir-range" style={{ ["--v" as string]: `${intent}%` }} />
        </FormField>
      </>}
    />
  );
}
