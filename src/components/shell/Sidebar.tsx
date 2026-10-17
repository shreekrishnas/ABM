"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Globe, PanelLeft, Building2, Workflow, ClipboardCheck, Send, Radar, Handshake, Users, BadgeDollarSign, ListTodo, BarChart3, Upload, Settings2, Sparkles, Sun,
} from "lucide-react";

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; count?: keyof Counts };
type Counts = { review: number; handoffs: number; tasks: number };

// Grouped by the job: daily work, the pipeline of companies, outreach, sales, insights.
export const GROUPS: { label: string; items: Item[] }[] = [
  { label: "", items: [{ href: "/work", label: "Today", icon: Sun }] },
  {
    label: "Pipeline",
    items: [
      { href: "/discover", label: "Discover", icon: Globe },
      { href: "/accounts", label: "Companies", icon: Building2 },
      { href: "/people", label: "People", icon: Users },
    ],
  },
  {
    label: "Outreach",
    items: [
      { href: "/review", label: "Approvals", icon: ClipboardCheck, count: "review" },
      { href: "/outreach", label: "Emails", icon: Send },
      { href: "/signals", label: "Signals", icon: Radar },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/handoffs", label: "Hand-offs", icon: Handshake, count: "handoffs" },
      { href: "/crm/opportunities", label: "Opportunities", icon: BadgeDollarSign },
      { href: "/crm/tasks", label: "Tasks", icon: ListTodo, count: "tasks" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/overview", label: "Program overview", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/pipeline", label: "Behind the scenes", icon: Workflow },
      { href: "/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

export function Sidebar({ counts, sellerName }: { counts: Counts; sellerName: string }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const toggle = () => {
    const mini = document.documentElement.dataset.nav !== "mini";
    if (mini) document.documentElement.dataset.nav = "mini";
    else delete document.documentElement.dataset.nav;
    try {
      localStorage.setItem("abm-nav", mini ? "mini" : "full");
    } catch {}
  };
  return (
    <nav className="sidebar" aria-label="Main">
      <Link href="/" className="brand" aria-label="ABM home">
        <span className="mark"><Sparkles size={15} strokeWidth={2.2} /></span>
        <span className="name">ABM<span className="sub">{sellerName}</span></span>
      </Link>
      {GROUPS.map((g) => (
        <div key={g.label} className="contents">
          {g.label && <span className="sidebar-label">{g.label}</span>}
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
      <button type="button" className="nav-item nav-collapse" onClick={toggle} aria-label="Collapse or expand the menu" title="Collapse / expand menu ( [ )">
        <PanelLeft size={16} strokeWidth={2} />
        <span className="lbl">Collapse menu</span>
      </button>
    </nav>
  );
}
