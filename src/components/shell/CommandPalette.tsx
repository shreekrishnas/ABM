"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, ChevronRight, CornerDownLeft, Loader2, Search, User, Zap } from "lucide-react";
import { SECTIONS, IMPORT_PAGES } from "@/lib/nav";
import { assignToMeAction, manualHandoffAction, runAccountAction } from "@/app/actions";
import { toast } from "@/components/client";
import { openTask } from "./QuickTask";

type Verb = { id: string; label: string; sub?: string; run: () => void | Promise<void>; confirm?: string };

type Hit = { id: string; label: string; sub?: string; href: string; kind: "page" | "action" | "company" | "person" };

const ACTIONS: Hit[] = [
  { id: "a-approve", kind: "action", label: "Approve emails", sub: "Open the approval queue", href: "/review" },
  { id: "a-task", kind: "action", label: "Add a task", sub: "Quick-add, due tomorrow by default", href: "#task" },
  { id: "a-brain", kind: "action", label: "Edit the Account Brain", sub: "Competitors, use cases, case studies…", href: "/brain" },
  { id: "a-handoffs", kind: "action", label: "Pick up hand-offs", sub: "Sales → Hand-offs", href: "/handoffs" },
  { id: "a-similar", kind: "action", label: "Find companies similar to a website", sub: "Import → Similar companies", href: "/import/lookalikes" },
  { id: "a-import", kind: "action", label: "Import a file", sub: "CSV or Excel of companies and people", href: "/import/upload" },
  { id: "a-scan", kind: "action", label: "Scan the market for new companies", sub: "Discover", href: "/discover" },
  { id: "a-visitors", kind: "action", label: "Review website visitors", sub: "Discover → Website visitors", href: "/discover?origin=website_visitor" },
  { id: "a-priority", kind: "action", label: "Companies by priority", sub: "Who to work first", href: "/accounts?view=list&sort=priority" },
];
const PAGES: Hit[] = [...IMPORT_PAGES.map((it) => ({ id: `p-${it.href}`, kind: "page" as const, label: it.label, sub: "Import data", href: it.href })), ...SECTIONS.flatMap((g) => g.items.map((it) => ({ id: `p-${it.href}`, kind: "page" as const, label: it.label, sub: g.label, href: it.href })))];

/**
 * ⌘K / Ctrl+K (or "/"): jump to any page, company or person, or start a common action.
 * On a company or person, → (or Tab) lists what you can do with it right here.
 */
export function CommandPalette({ canAct = true }: { canAct?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Hit | null>(null);
  const [busy, start] = useTransition();

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
      setTarget(null);
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
    if (h.href === "#task") return openTask({ origin: "palette" });
    router.push(h.href);
  }, [router]);

  // What you can do with one company or person, without opening it first.
  const verbs = useMemo<Verb[]>(() => {
    if (!target) return [];
    const id = target.href.split("/").pop()!;
    const done = (p: Promise<{ ok: boolean; message: string } | null>) => start(async () => { const r = await p; toast(r); router.refresh(); });
    if (target.kind === "person") return [
      { id: "open", label: "Open", sub: target.label, run: () => go(target) },
      { id: "task", label: "Add a task", sub: "About this person", run: () => { setOpen(false); openTask({ contactId: id, label: target.label, origin: "palette" }); } },
    ];
    return [
      { id: "open", label: "Open", sub: target.label, run: () => go(target) },
      { id: "preview", label: "Preview beside the list", sub: "Companies list with this one open", run: () => { setOpen(false); router.push(`/accounts?view=list&sel=${id}`); } },
      ...(canAct ? [
        { id: "mine", label: "Assign to me", sub: "Become the owner", run: () => done(assignToMeAction(id)) },
        { id: "run", label: "Run research now", sub: "Continue the pipeline from its next stage", run: () => done(runAccountAction(id, undefined)) },
        { id: "handoff", label: "Hand off to sales", sub: "Pauses automated outreach", confirm: `Hand ${target.label} to its owner now? Automated outreach will pause.`, run: () => done(manualHandoffAction(id)) },
      ] : []),
      { id: "similar", label: "Find companies like this", sub: "Lookalikes", run: () => { setOpen(false); router.push(`/import/lookalikes?seed=${encodeURIComponent(target.sub?.split(" · ")[0] || target.label)}`); } },
      { id: "task", label: "Add a task", sub: "About this company", run: () => { setOpen(false); openTask({ accountId: id, label: target.label, origin: "palette" }); } },
    ];
  }, [target, canAct, go, router]);
  const runVerb = (v: Verb | undefined) => {
    if (!v || busy) return;
    if (v.confirm && !window.confirm(v.confirm)) return;
    void v.run();
  };
  const list: (Hit | Verb)[] = target ? verbs : hits;

  if (!open) return null;
  const Icon = { page: ArrowRight, action: Zap, company: Building2, person: User };
  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          {target ? <button type="button" className="br-icon" onClick={() => { setTarget(null); setI(0); }} aria-label="Back"><ArrowLeft size={16} /></button> : <Search size={17} />}
          {target && <span className="pal-target">{target.label}</span>}
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              const cur = hits[i];
              if (e.key === "ArrowDown") (e.preventDefault(), setI((x) => Math.min(list.length - 1, x + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setI((x) => Math.max(0, x - 1)));
              else if (!target && (e.key === "ArrowRight" || e.key === "Tab") && cur && (cur.kind === "company" || cur.kind === "person")) (e.preventDefault(), setTarget(cur), setI(0));
              else if (target && (e.key === "ArrowLeft" || (e.key === "Backspace" && !q))) (e.preventDefault(), setTarget(null), setI(0));
              else if (e.key === "Enter") (e.preventDefault(), target ? runVerb(verbs[i]) : go(cur));
              else if (e.key === "Escape") (target ? (setTarget(null), setI(0)) : setOpen(false));
            }}
            placeholder={target ? `What do you want to do with ${target.label}?` : "Search companies, people, pages and actions…"}
            aria-label="Search"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {target ? verbs.map((v, n) => (
            <li key={v.id} role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseEnter={() => setI(n)} onClick={() => runVerb(v)}>
              <Zap size={15} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{v.label}</span>{v.sub && <span className="muted block truncate text-xs">{v.sub}</span>}</span>
              {busy && n === i ? <Loader2 size={13} className="lg-spin" /> : n === i && <CornerDownLeft size={13} />}
            </li>
          )) : (
            <>
              {hits.length === 0 && <li className="muted px-4 py-6 text-center text-sm">Nothing found for “{q}”</li>}
              {hits.map((h, n) => {
                const I = Icon[h.kind];
                const record = h.kind === "company" || h.kind === "person";
                return (
                  <li key={h.id + h.kind} role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseEnter={() => setI(n)} onClick={() => go(h)}>
                    <I size={15} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{h.label}</span>{h.sub && <span className="muted block truncate text-xs">{h.sub}</span>}</span>
                    <span className="muted text-[0.68rem] capitalize">{h.kind}</span>
                    {record && <button type="button" className="pal-more" onClick={(e) => { e.stopPropagation(); setTarget(h); setI(0); }} title="Actions (→)">Actions <ChevronRight size={12} /></button>}
                    {n === i && !record && <CornerDownLeft size={13} />}
                  </li>
                );
              })}
            </>
          )}
        </ul>
        <div className="palette-foot muted">{target ? <>↑↓ choose · Enter do it · <kbd>←</kbd> back</> : <>↑↓ choose · Enter open · <kbd>→</kbd> actions on a company or person · <kbd>⌘K</kbd> anywhere</>}</div>
      </div>
    </div>
  );
}
