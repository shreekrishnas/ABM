"use client";

import Link from "next/link";
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
      { href: "/", label: "Today", icon: Sun },
      { href: "/accounts", label: "Companies", icon: Building2 },
      { href: "/people", label: "People", icon: Users },
      { href: "/review", label: "Approvals", icon: ClipboardCheck, count: "review" },
      { href: "/outreach", label: "Emails", icon: Send },
    ],
  },
  {
    label: "Flow",
    items: [
      { href: "/import", label: "Import", icon: Upload },
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

export function Sidebar({ counts, sellerName }: { counts: Counts; sellerName: string }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="sidebar" aria-label="Main">
      <Link href="/" className="brand" aria-label="ABM home">
        <span className="mark"><Sparkles size={15} strokeWidth={2.2} /></span>
        <span className="name">ABM<span className="sub">{sellerName}</span></span>
      </Link>
      {GROUPS.map((g) => (
        <div key={g.label} className="contents">
          <span className="sidebar-label">{g.label}</span>
          {g.items.map((it) => {
            const Icon = it.icon;
            const n = it.count ? counts[it.count] : 0;
            const active = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined} title={it.label}>
                <Icon size={16} strokeWidth={2} />
                <span className="lbl truncate">{it.label}</span>
                {n > 0 && <span className={`count tnum${it.count === "review" ? " alert" : ""}`}>{n > 99 ? "99+" : n}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
