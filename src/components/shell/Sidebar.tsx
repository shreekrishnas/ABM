"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Workflow, ClipboardCheck, Send, Radar, Handshake, Users, BadgeDollarSign, ListTodo, BarChart3, Upload, Settings2, Sparkles, Sun,
} from "lucide-react";

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; count?: keyof Counts };
type Counts = { review: number; handoffs: number; tasks: number };

// v2: grouped by the job, not by the system. Daily work first; plumbing last.
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Work",
    items: [
      { href: "/", label: "Today — what needs you", icon: Sun },
      { href: "/accounts", label: "Companies", icon: Building2 },
      { href: "/people", label: "People", icon: Users },
      { href: "/review", label: "Approvals & checks", icon: ClipboardCheck, count: "review" },
      { href: "/outreach", label: "Emails", icon: Send },
    ],
  },
  {
    label: "Flow",
    items: [
      { href: "/import", label: "Import companies & people", icon: Upload },
      { href: "/signals", label: "Signals", icon: Radar },
      { href: "/handoffs", label: "Hand-offs to sales", icon: Handshake, count: "handoffs" },
      { href: "/pipeline", label: "Behind the scenes", icon: Workflow },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/crm/opportunities", label: "Opportunities", icon: BadgeDollarSign },
      { href: "/crm/tasks", label: "Tasks", icon: ListTodo, count: "tasks" },
    ],
  },
  {
    label: "Results",
    items: [
      { href: "/overview", label: "Program overview", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/settings", label: "Settings", icon: Settings2 },
    ],
  },
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
        <div key={g.label} className="contents">
          {i > 0 && <div className="sidebar-sep" />}
          <span className="sidebar-label" aria-hidden>{g.label}</span>
          {g.items.map((it) => {
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
