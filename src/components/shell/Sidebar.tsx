"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Workflow, ClipboardCheck, Send, Radar, Handshake, Users, BadgeDollarSign, ListTodo, BarChart3, Upload, Settings2, Sparkles,
} from "lucide-react";

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; count?: keyof Counts };
type Counts = { review: number; handoffs: number; tasks: number };

const GROUPS: Item[][] = [
  [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/accounts", label: "Companies", icon: Building2 },
    { href: "/people", label: "People", icon: Users },
    { href: "/pipeline", label: "Pipeline", icon: Workflow },
    { href: "/review", label: "Review queue", icon: ClipboardCheck, count: "review" },
  ],
  [
    { href: "/outreach", label: "Outreach", icon: Send },
    { href: "/signals", label: "Signals", icon: Radar },
    { href: "/handoffs", label: "Sales handoffs", icon: Handshake, count: "handoffs" },
  ],
  [
    { href: "/crm/opportunities", label: "CRM · Opportunities", icon: BadgeDollarSign },
    { href: "/crm/tasks", label: "CRM · Tasks", icon: ListTodo, count: "tasks" },
  ],
  [
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/import", label: "Import Companies & People", icon: Upload },
    { href: "/settings", label: "Settings", icon: Settings2 },
  ],
];

type Tip = { label: string; top: number; left: number } | null;

// The rail scrolls and the glass shell clips overflow, so a CSS ::after label
// gets hidden behind the content area. Render the label in a portal on <body>.
function SidebarTooltip({ tip }: { tip: Tip }) {
  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div role="tooltip" className="sidebar-tooltip" style={{ top: tip.top, left: tip.left }}>
      {tip.label}
    </div>,
    document.body,
  );
}

export function Sidebar({ counts }: { counts: Counts }) {
  const path = usePathname();
  const [tip, setTip] = useState<Tip>(null);
  const show = (label: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 12 });
  };
  const hide = () => setTip(null);
  useEffect(() => setTip(null), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="sidebar" aria-label="Main">
      <Link href="/" className="logo-mark" aria-label="ABM Intelligence home">
        <Sparkles size={20} strokeWidth={2.2} />
      </Link>
      {GROUPS.map((g, i) => (
        <div key={i} className="contents">
          {i > 0 && <div className="sidebar-sep" />}
          {g.map((it) => {
            const Icon = it.icon;
            const n = it.count ? counts[it.count] : 0;
            return (
              <Link key={it.href} href={it.href} className={`sidebar-item${isActive(it.href) ? " active" : ""}`} aria-label={it.label} onMouseEnter={show(it.label)} onMouseLeave={hide} onFocus={show(it.label)} onBlur={hide} onClick={hide} aria-current={isActive(it.href) ? "page" : undefined}>
                <Icon size={20} strokeWidth={2} />
                {n > 0 && <span className="count tnum">{n > 99 ? "99+" : n}</span>}
              </Link>
            );
          })}
        </div>
      ))}
      <SidebarTooltip tip={tip} />
    </nav>
  );
}
