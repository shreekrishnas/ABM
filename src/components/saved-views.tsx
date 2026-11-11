"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, ChevronDown, Trash2, Users } from "lucide-react";
import { deleteViewAction, saveViewAction } from "@/app/views/actions";
import type { ViewItem } from "@/lib/views";

/** "Views" menu: built-in and saved filter sets for a list, and "Save this view". */
export function SavedViews({ page, builtIn, views }: { page: string; builtIn: { name: string; query: string }[]; views: ViewItem[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const current = new URLSearchParams(sp.toString());
  for (const k of ["page", "peek", "sel"]) current.delete(k);
  const now = current.toString();
  const go = (q: string) => { setOpen(false); router.push(`${path}${q ? `?${q}` : ""}`); };
  const active = [...builtIn.map((b) => ({ name: b.name, query: b.query })), ...views].find((v) => v.query === now)?.name;

  return (
    <div className="sv" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bookmark size={14} /> {active ?? "Views"} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="sv-menu" role="menu">
          <button type="button" className={`sv-i${!now ? " on" : ""}`} onClick={() => go("")}>All</button>
          {builtIn.map((b) => <button key={b.name} type="button" className={`sv-i${now === b.query ? " on" : ""}`} onClick={() => go(b.query)}>{b.name}</button>)}
          {views.length > 0 && <div className="sv-sep">Saved</div>}
          {views.map((v) => (
            <div key={v.id} className="sv-row">
              <button type="button" className={`sv-i${now === v.query ? " on" : ""}`} onClick={() => go(v.query)}>{v.name}{v.shared && <Users size={12} aria-label="Shared with the team" />}</button>
              {v.mine && <button type="button" className="sv-del" aria-label={`Delete ${v.name}`} title="Delete" onClick={() => start(async () => { const r = await deleteViewAction(v.id); setMsg(r.message); router.refresh(); })}><Trash2 size={13} /></button>}
            </div>
          ))}
          <div className="sv-sep">Save the current filters</div>
          <form className="sv-save" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveViewAction(page, name, now, shared); setMsg(r.message); if (r.ok) { setName(""); router.refresh(); } }); }}>
            <input className="glass-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" aria-label="View name" maxLength={60} />
            <label className="sv-share"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with the team</label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>Save view</button>
          </form>
          {msg && <p className="sv-msg" role="status">{msg}</p>}
        </div>
      )}
    </div>
  );
}
