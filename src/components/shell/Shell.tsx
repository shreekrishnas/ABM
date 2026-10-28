"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Brain, Building2, Handshake, Home as HomeIcon, LogOut, Send, Settings2, ShieldCheck, Sun, Upload, Users } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { signOutAction, switchClientAction, switchModeAction } from "@/app/login/actions";
import { isOn, locate, type Counts } from "@/lib/nav";

// Rail entries: Home, Import, then the workspace sections. Active state follows the
// nav map, so every page inside a section lights its rail icon.
const RAIL = [
  { key: "home", href: "/", label: "Home", short: "Home", icon: HomeIcon },
  { key: "import", href: "/import", label: "Import", short: "Import", icon: Upload },
  { key: "brain", href: "/brain", label: "Account Brain", short: "Brain", icon: Brain },
  { key: "today", href: "/work/today", label: "Today", short: "Today", icon: Sun },
  { key: "research", href: "/accounts", label: "Research", short: "Research", icon: Building2 },
  { key: "outreach", href: "/review", label: "Email drafting", short: "Emails", icon: Send, count: "review" as const },
  { key: "sales", href: "/handoffs", label: "Sales", short: "Sales", icon: Handshake, count: "handoffs" as const },
  { key: "insights", href: "/overview", label: "Insights", short: "Insights", icon: BarChart3 },
];

export type Access = { name: string; email: string; canSuperAdmin: boolean; superAdmin: boolean; clients: string[]; state: "ok" | "noclient" | "removed"; choices: { id: string; name: string }[]; picked: string | null; everyClient: boolean } | null;

/** The glass shell every signed-in page lives in: atmosphere → glass panel → rail + content. */
export function Shell({ counts, access, children }: { counts: Counts; access: Access; children: React.ReactNode }) {
  const path = usePathname();
  if (path.startsWith("/login")) return <main id="main">{children}</main>;
  if (access?.state === "removed") return <Gate title="Your access has been removed" text="Ask ShreeKrishna if you think this is a mistake." />;
  if (access?.state === "noclient") return <Gate title={`Welcome, ${access.name.split(" ")[0]}`} text="You're on the team, but no client is assigned to you yet. ShreeKrishna will assign one; this page opens up as soon as he does." />;
  const at = locate(path);
  const active = isOn(path, "/team") ? "team" : isOn(path, "/brain") ? "brain" : at.area === "home" ? "home" : at.area === "import" ? "import" : isOn(path, "/settings") ? "settings" : (at.section?.key ?? "");
  const sup = Boolean(access?.superAdmin);
  return (
    <div className="sh-outer">
      <div className="sh">
        <nav className="sh-rail" aria-label="Main">
          <Link href="/" className="sh-logo" aria-label="ABM home"><LogoMark size={42} /></Link>
          <div className="sh-rail-items">
            {RAIL.map((r) => {
              const n = r.count ? counts[r.count] : 0;
              return (
                <Link key={r.key} href={r.href} className={`sh-item${active === r.key ? " on" : ""}`} data-tip={r.label} aria-label={r.label} aria-current={active === r.key ? "page" : undefined}>
                  <r.icon size={20} strokeWidth={1.9} aria-hidden />
                  <span className="sh-lbl">{r.short}</span>
                  {n > 0 && <span className="sh-badge tnum" aria-label={`${n} waiting`}>{n > 99 ? "99+" : n}</span>}
                </Link>
              );
            })}
          </div>
          <div className="sh-rail-foot">
            {sup && <Link href="/team" className={`sh-item${active === "team" ? " on" : ""}`} data-tip="Team & Access" aria-label="Team & Access"><Users size={20} strokeWidth={1.9} /></Link>}
            {access?.canSuperAdmin && (
              <form action={switchModeAction.bind(null, sup ? "user" : "super")}>
                <button type="submit" className={`sh-item sh-mode${sup ? " on" : ""}`} data-tip={sup ? "Switch to User" : "Switch to Super Admin"} aria-label={sup ? "Switch to User" : "Switch to Super Admin"}><ShieldCheck size={20} strokeWidth={1.9} /></button>
              </form>
            )}
            <Link href="/settings" className={`sh-item${active === "settings" ? " on" : ""}`} data-tip="Settings" aria-label="Settings"><Settings2 size={20} strokeWidth={1.9} /></Link>
            <span className="sh-sep" aria-hidden />
            <form action={signOutAction}><button type="submit" className="sh-item" data-tip="Sign out" aria-label="Sign out"><LogOut size={20} strokeWidth={1.9} /></button></form>
          </div>
        </nav>
        <div className="sh-body" id="sh-scroll">
          {sup && (
            <div className="sh-super" role="status">
              <ShieldCheck size={16} /> <b>Super Admin mode</b> <span className="hide-sm">Team, clients and access can be changed. Every action is logged.</span>
              <Link href="/team" className="sh-super-link">Team & Access</Link>
              <form action={switchModeAction.bind(null, "user")}><button type="submit" className="sh-super-btn">Switch to User</button></form>
            </div>
          )}
          {access && access.choices.length > 1 && <ClientBar choices={access.choices} picked={access.picked} everyClient={access.everyClient} />}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Which client's companies every page shows. Only there when a person has more than one. */
function ClientBar({ choices, picked, everyClient }: { choices: { id: string; name: string }[]; picked: string | null; everyClient: boolean }) {
  const opts = [{ id: "all", name: everyClient ? "All clients" : "All my clients" }, ...choices];
  return (
    <div className="sh-clients" role="group" aria-label="Client">
      <span className="sh-clients-k">Client</span>
      {opts.map((c) => {
        const on = (picked ?? "all") === c.id;
        return (
          <form key={c.id} action={switchClientAction.bind(null, c.id)}>
            <button type="submit" className={`sh-client${on ? " on" : ""}`} aria-pressed={on}>{c.name}</button>
          </form>
        );
      })}
      {!picked && <span className="sh-clients-note">Pick one client to import or add companies</span>}
    </div>
  );
}

function Gate({ title, text }: { title: string; text: string }) {
  return (
    <div className="sh-gate">
      <div className="sh-gate-card">
        <LogoMark size={48} />
        <h1>{title}</h1>
        <p>{text}</p>
        <form action={signOutAction}><button type="submit" className="btn btn-secondary">Sign out</button></form>
      </div>
    </div>
  );
}
