"use client";

// Notifications: a bell in the top bar and a side panel. Built from existing records on open;
// "unread" is whatever arrived after this browser last opened the panel.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ClipboardCheck, DollarSign, Globe2, Handshake, ListTodo, MessageSquareReply, X } from "lucide-react";
import { loadNotifications } from "./notification-actions";
import type { Notice } from "@/lib/notifications";

const KEY = "abm:notices-seen";
const ICON = { reply: MessageSquareReply, approval: ClipboardCheck, handoff: Handshake, task: ListTodo, visitor: Globe2, system: AlertTriangle, spend: DollarSign, error: AlertTriangle } as const;

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
};

export function NotificationBell() {
  const [items, setItems] = useState<Notice[] | null>(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string>("");
  const refresh = useCallback(() => loadNotifications().then(setItems).catch(() => setItems([])), []);
  useEffect(() => {
    try { setSeen(localStorage.getItem(KEY) ?? ""); } catch {}
    refresh();
    const t = setInterval(refresh, 120_000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  const unread = (items ?? []).filter((n) => !seen || n.at > seen).length;
  const show = () => {
    setOpen(true);
    refresh();
    const now = new Date().toISOString();
    try { localStorage.setItem(KEY, now); } catch {}
    setTimeout(() => setSeen(now), 1500);
  };
  return (
    <>
      <button type="button" className="nav-icon nb-btn" onClick={show} aria-label={`Notifications${unread ? ` (${unread} new)` : ""}`} title="Notifications">
        <Bell size={17} strokeWidth={1.75} />
        {unread > 0 && <span className="nav-dotcount tnum">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="nb-scrim" onMouseDown={() => setOpen(false)} />
          <aside className="nb-panel" role="dialog" aria-label="Notifications">
            <header className="nb-head"><h2>Notifications</h2><button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button></header>
            <div className="nb-list">
              {items === null ? <p className="nb-empty">Loading…</p>
                : items.length === 0 ? <p className="nb-empty"><CheckCircle2 size={18} /> You&apos;re all caught up.</p>
                : items.map((n) => {
                    const Icon = ICON[n.kind];
                    return (
                      <Link key={n.id} href={n.href} className={`nb-item${!seen || n.at > seen ? " new" : ""}`} onClick={() => setOpen(false)}>
                        <span className={`nb-ic ${n.tone}`}><Icon size={15} /></span>
                        <span className="nb-t"><b>{n.title}</b><small>{n.detail}</small></span>
                        <span className="nb-at">{ago(n.at)}</span>
                      </Link>
                    );
                  })}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
