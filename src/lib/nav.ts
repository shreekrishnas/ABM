// The app's map: Home, then the modules (Accounts, Prospecting, Engage, Pipeline, Insights, Admin) › page.
// Used by the top bar (trail and sibling pages), the hub pages and the command palette.

import {
  BadgeDollarSign, BarChart3, Brain, Building2, ClipboardCheck, FileSpreadsheet, Globe, Globe2, Handshake, LayoutDashboard, ListTodo, Plug, Radar, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Upload, Users, Workflow,
} from "lucide-react";

export type Counts = { review: number; handoffs: number; tasks: number };
export type Icon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
/** `extra` pages are hidden from menus until a Super Admin switches them on for the client; they still open by address. */
export type NavPage = { href: string; label: string; blurb: string; icon: Icon; count?: keyof Counts; extra?: boolean };
export type NavSection = { key: string; label: string; blurb: string; icon: Icon; items: NavPage[] };

export const IMPORT_PAGES: NavPage[] = [
  { href: "/import/upload", label: "Upload CSV", blurb: "Map columns, preview, import", icon: FileSpreadsheet },
  { href: "/import/describe", label: "Describe companies", blurb: "Find companies from a description", icon: Radar },
  { href: "/import/lookalikes", label: "Lookalikes", blurb: "Companies like one website", icon: Sparkles, extra: true },
  { href: "/import/apollo", label: "Website visitors", blurb: "Companies visiting your website", icon: Globe2 },
];

// The product's modules. Every page keeps its address; modules only group them.
export const SECTIONS: NavSection[] = [
  {
    key: "accounts", label: "Accounts", blurb: "Every company, its people and the signals behind it", icon: Building2,
    items: [
      { href: "/accounts", label: "Companies", blurb: "Every company: filter, sort, table or priority map", icon: Building2 },
      { href: "/people", label: "People", blurb: "The buying group at each company", icon: Users },
      { href: "/accounts/coverage", label: "Coverage", blurb: "Buying groups by role: who is found, contacted, engaged", icon: Users, extra: true },
      { href: "/signals", label: "Signals", blurb: "Buying events, with sources", icon: Radar, extra: true },
    ],
  },
  {
    key: "prospecting", label: "Prospecting", blurb: "Find new companies and bring them in", icon: Globe,
    items: [
      { href: "/import", label: "All ways in", blurb: "Every way to bring companies in", icon: Upload },
      ...IMPORT_PAGES,
      { href: "/discover", label: "Market signals", blurb: "New companies and rising industries", icon: Globe, extra: true },
    ],
  },
  {
    key: "engage", label: "Engage", blurb: "Today's work, approvals and conversations", icon: Send,
    items: [
      { href: "/work/today", label: "Today", blurb: "Replies, approvals, follow-ups and hot companies", icon: Sun },
      { href: "/review", label: "Approvals", blurb: "Drafts and decisions waiting for you", icon: ClipboardCheck, count: "review" },
      { href: "/outreach", label: "Emails", blurb: "Sequences, sent emails and replies", icon: Send },
    ],
  },
  {
    key: "pipeline", label: "Pipeline", blurb: "Hand-offs, deals and tasks", icon: Handshake,
    items: [
      { href: "/handoffs", label: "Hand-offs", blurb: "Companies ready for a rep", icon: Handshake, count: "handoffs" },
      { href: "/crm/opportunities", label: "Deals", blurb: "Open deals by stage", icon: BadgeDollarSign },
      { href: "/crm/tasks", label: "Tasks", blurb: "Due and overdue work", icon: ListTodo, count: "tasks" },
    ],
  },
  {
    key: "insights", label: "Insights", blurb: "How the program is doing", icon: BarChart3,
    items: [
      { href: "/overview", label: "Program overview", blurb: "Coverage, pipeline and results", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", blurb: "Trends and conversion", icon: BarChart3, extra: true },
      { href: "/pipeline", label: "Behind the scenes", blurb: "What the brain did and why", icon: Workflow, extra: true },
    ],
  },
  {
    key: "admin", label: "Admin", blurb: "Connections, brain, team and settings", icon: Settings2,
    items: [
      { href: "/admin", label: "Overview", blurb: "Workspace settings in one place", icon: Settings2 },
      { href: "/admin/integrations", label: "Integrations", blurb: "Every connection, its status and last sync", icon: Plug },
      { href: "/brain", label: "Account Brain", blurb: "What the client sells and to whom", icon: Brain },
      { href: "/settings", label: "Settings", blurb: "Seller pack, senders, knowledge", icon: SlidersHorizontal },
      { href: "/team", label: "Team & Access", blurb: "People, accounts, system health (Super Admin)", icon: ShieldCheck },
    ],
  },
];

/** The pages to list: everything when extras are on, else the core pages (plus the one being viewed). */
export const shown = (items: NavPage[], extras: boolean, path?: string) => (extras ? items : items.filter((p) => !p.extra || (path != null && (path === p.href || path.startsWith(`${p.href}/`)))));

export const isOn = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Where a path sits in the map: the area, the section and the page, for the trail. */
export function locate(path: string): { area: "home" | "import" | "work"; section?: NavSection; page?: NavPage } {
  if (path === "/") return { area: "home" };
  const sectionKey = path.match(/^\/work\/([^/]+)/)?.[1];
  for (const s of SECTIONS) {
    // The most specific page wins (/import/upload is Upload CSV, not "All ways in").
    const page = s.items.filter((p) => isOn(path, p.href)).sort((a, b) => b.href.length - a.href.length)[0];
    if (page || s.key === sectionKey) return { area: "work", section: s, page };
  }
  return { area: "work" };
}

/** Where a section card goes: straight to the page when the section has one, else the section's hub. */
export const sectionHref = (s: NavSection) => s.items[0].href;
