// The app's drill-down map: Home › Import data | Workspace › section › page.
// Used by the top bar (trail and sibling pages), the hub pages and the command palette.

import {
  BadgeDollarSign, BarChart3, Building2, ClipboardCheck, FileSpreadsheet, Globe, Globe2, Handshake, LayoutDashboard, ListTodo, Radar, Send, Settings2, Sparkles, Sun, Users, Workflow,
} from "lucide-react";

export type Counts = { review: number; handoffs: number; tasks: number };
export type Icon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
export type NavPage = { href: string; label: string; blurb: string; icon: Icon; count?: keyof Counts };
export type NavSection = { key: string; label: string; blurb: string; icon: Icon; items: NavPage[] };

export const IMPORT_PAGES: NavPage[] = [
  { href: "/import/upload", label: "Upload CSV", blurb: "Map columns, preview, import", icon: FileSpreadsheet },
  { href: "/import/describe", label: "Describe companies", blurb: "Find companies from a description", icon: Radar },
  { href: "/import/lookalikes", label: "Lookalikes", blurb: "Companies like one website", icon: Sparkles },
  { href: "/import/apollo", label: "Via Apollo", blurb: "Companies visiting your website", icon: Globe2 },
];

export const SECTIONS: NavSection[] = [
  { key: "today", label: "Today", blurb: "What needs a person right now", icon: Sun, items: [{ href: "/work/today", label: "Today", blurb: "Replies, approvals, follow-ups and hot companies", icon: Sun }] },
  {
    key: "research", label: "Research", blurb: "Companies, people and the signals behind them", icon: Building2,
    items: [
      { href: "/accounts", label: "Companies", blurb: "Every company: filter, sort, table or priority map", icon: Building2 },
      { href: "/accounts/coverage", label: "Coverage", blurb: "Buying groups by role: who is found, contacted, engaged", icon: Users },
      { href: "/people", label: "People", blurb: "The buying group at each company", icon: Users },
      { href: "/signals", label: "Signals", blurb: "Buying events, with sources", icon: Radar },
      { href: "/discover", label: "Discover", blurb: "New companies and rising industries", icon: Globe },
    ],
  },
  {
    key: "outreach", label: "Email drafting", blurb: "Drafts to approve and what was sent", icon: Send,
    items: [
      { href: "/review", label: "Approvals", blurb: "Drafts and decisions waiting for you", icon: ClipboardCheck, count: "review" },
      { href: "/outreach", label: "Emails", blurb: "Sequences, sent emails and replies", icon: Send },
    ],
  },
  {
    key: "sales", label: "CRM", blurb: "Hand-offs, opportunities and tasks", icon: Handshake,
    items: [
      { href: "/handoffs", label: "Hand-offs", blurb: "Companies ready for a rep", icon: Handshake, count: "handoffs" },
      { href: "/crm/opportunities", label: "Opportunities", blurb: "Open deals by stage", icon: BadgeDollarSign },
      { href: "/crm/tasks", label: "Tasks", blurb: "Due and overdue work", icon: ListTodo, count: "tasks" },
    ],
  },
  {
    key: "insights", label: "Insights", blurb: "How the program is doing, and settings", icon: BarChart3,
    items: [
      { href: "/overview", label: "Program overview", blurb: "Coverage, pipeline and results", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", blurb: "Trends and conversion", icon: BarChart3 },
      { href: "/pipeline", label: "Behind the scenes", blurb: "What the brain did and why", icon: Workflow },
      { href: "/settings", label: "Settings", blurb: "Seller pack, senders, connections", icon: Settings2 },
    ],
  },
];

export const isOn = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Where a path sits in the map: the area, the section and the page, for the trail. */
export function locate(path: string): { area: "home" | "import" | "work"; section?: NavSection; page?: NavPage } {
  if (path === "/") return { area: "home" };
  if (isOn(path, "/import")) return { area: "import", page: IMPORT_PAGES.find((p) => isOn(path, p.href)) };
  const sectionKey = path.match(/^\/work\/([^/]+)/)?.[1];
  for (const s of SECTIONS) {
    if (s.key === sectionKey) return { area: "work", section: s, page: s.items.find((p) => isOn(path, p.href)) };
    const page = s.items.find((p) => isOn(path, p.href));
    if (page) return { area: "work", section: s, page };
  }
  return { area: "work" };
}

/** Where a section card goes: straight to the page when the section has one, else the section's hub. */
export const sectionHref = (s: NavSection) => s.items[0].href;
