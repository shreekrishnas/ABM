"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

/**
 * One row: search grows, a few compact controls stay inline, the long tail of filters lives in a
 * drawer. The drawer's button shows how many filters are on and the result count.
 */
export function FilterBar({ search, inline, drawer, activeCount = 0, resultCount, onClear }: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  inline?: ReactNode; drawer?: ReactNode; activeCount?: number; resultCount?: number; onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="k-fbar">
      {search && (
        <label className="k-search">
          <Search size={15} aria-hidden />
          <input value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder ?? "Search…"} aria-label={search.placeholder ?? "Search"} />
          {search.value && <button type="button" onClick={() => search.onChange("")} aria-label="Clear search"><X size={14} /></button>}
        </label>
      )}
      {inline}
      {drawer && <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(true)}><SlidersHorizontal size={14} /> Filters{activeCount ? ` · ${activeCount}` : ""}</button>}
      {activeCount > 0 && onClear && <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>}
      {resultCount != null && <span className="k-fbar-count tnum">{resultCount.toLocaleString()} result{resultCount === 1 ? "" : "s"}</span>}
      {drawer && <Drawer open={open} onClose={() => setOpen(false)} title="Filters" footer={<button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Show {resultCount != null ? `${resultCount.toLocaleString()} result${resultCount === 1 ? "" : "s"}` : "results"}</button>}>{drawer}</Drawer>}
    </div>
  );
}

/** Side panel on desktop, bottom sheet on phones. Escape and the backdrop close it. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="k-drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="k-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header><b>{title}</b><button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <div className="k-drawer-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </div>
  );
}
