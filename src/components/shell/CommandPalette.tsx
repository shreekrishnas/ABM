"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CornerDownLeft, Search, User, Zap } from "lucide-react";
import { SECTIONS, IMPORT_PAGES } from "@/lib/nav";

type Hit = { id: string; label: string; sub?: string; href: string; kind: "page" | "action" | "company" | "person" };

const ACTIONS: Hit[] = [
  { id: "a-approve", kind: "action", label: "Approve emails", sub: "Open the approval queue", href: "/review" },
  { id: "a-similar", kind: "action", label: "Find companies similar to a website", sub: "Import → Similar companies", href: "/import/lookalikes" },
  { id: "a-import", kind: "action", label: "Import a file", sub: "CSV or Excel of companies and people", href: "/import/upload" },
  { id: "a-scan", kind: "action", label: "Scan the market for new companies", sub: "Discover", href: "/discover" },
  { id: "a-visitors", kind: "action", label: "Review website visitors", sub: "Discover → Website visitors", href: "/discover?origin=website_visitor" },
  { id: "a-priority", kind: "action", label: "Companies by priority", sub: "Who to work first", href: "/accounts?view=list&sort=priority" },
];
const PAGES: Hit[] = [...IMPORT_PAGES.map((it) => ({ id: `p-${it.href}`, kind: "page" as const, label: it.label, sub: "Import data", href: it.href })), ...SECTIONS.flatMap((g) => g.items.map((it) => ({ id: `p-${it.href}`, kind: "page" as const, label: it.label, sub: g.label, href: it.href })))];

/** ⌘K / Ctrl+K (or "/"): jump to any page, company or person, or start a common action. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "[" && !typing && !e.metaKey && !e.ctrlKey) {
        document.querySelector<HTMLButtonElement>(".nav-collapse")?.click();
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("abm:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("abm:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setFound([]);
      setI(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { companies: [], people: [] }))
        .then((d: { companies: Omit<Hit, "kind">[]; people: Omit<Hit, "kind">[] }) => setFound([...d.companies.map((x) => ({ ...x, kind: "company" as const })), ...d.people.map((x) => ({ ...x, kind: "person" as const }))]))
        .catch(() => {});
    }, 140);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    const match = (h: Hit) => !t || `${h.label} ${h.sub ?? ""}`.toLowerCase().includes(t);
    return [...found, ...ACTIONS.filter(match), ...PAGES.filter(match)].slice(0, 14);
  }, [q, found]);

  const go = useCallback((h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    router.push(h.href);
  }, [router]);

  if (!open) return null;
  const Icon = { page: ArrowRight, action: Zap, company: Building2, person: User };
  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={17} />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setI((x) => Math.min(hits.length - 1, x + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setI((x) => Math.max(0, x - 1)));
              else if (e.key === "Enter") (e.preventDefault(), go(hits[i]));
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search companies, people, pages and actions…"
            aria-label="Search"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {hits.length === 0 && <li className="muted px-4 py-6 text-center text-sm">Nothing found for “{q}”</li>}
          {hits.map((h, n) => {
            const I = Icon[h.kind];
            return (
              <li key={h.id + h.kind} role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseEnter={() => setI(n)} onClick={() => go(h)}>
                <I size={15} />
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{h.label}</span>{h.sub && <span className="muted block truncate text-xs">{h.sub}</span>}</span>
                <span className="muted text-[0.68rem] capitalize">{h.kind}</span>
                {n === i && <CornerDownLeft size={13} />}
              </li>
            );
          })}
        </ul>
        <div className="palette-foot muted">↑↓ choose · Enter open · <kbd>⌘K</kbd> or <kbd>/</kbd> anywhere · <kbd>[</kbd> collapse menu</div>
      </div>
    </div>
  );
}
