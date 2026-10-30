"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Brain, Building2, Check, ChevronDown, Handshake, Home as HomeIcon, LayoutGrid, LogOut, MoreHorizontal, Send, Settings2, ShieldCheck, Sun, Upload, Users, X } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { signOutAction, switchClientAction, switchModeAction } from "@/app/login/actions";
import { AccountLogo } from "@/components/account-logo";
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
  { key: "sales", href: "/handoffs", label: "CRM", short: "CRM", icon: Handshake, count: "handoffs" as const },
  { key: "insights", href: "/overview", label: "Insights", short: "Insights", icon: BarChart3 },
];

const PHONE = ["home", "today", "research", "outreach"];

export type Access = { name: string; email: string; canSuperAdmin: boolean; superAdmin: boolean; clients: string[]; state: "ok" | "noclient" | "removed"; choices: { id: string; name: string; logoUrl?: string | null }[]; picked: string | null; everyClient: boolean } | null;

/** The glass shell every signed-in page lives in: atmosphere → glass panel → rail + content. */
export function Shell({ counts, access, children }: { counts: Counts; access: Access; children: React.ReactNode }) {
  const path = usePathname();
  if (path.startsWith("/login")) return <main id="main">{children}</main>;
  if (access?.state === "removed") return <Gate title="Your access has been removed" text="Ask ShreeKrishna if you think this is a mistake." />;
  if (access?.state === "noclient") return <Gate title={`Welcome, ${access.name.split(" ")[0]}`} text="You're on the team, but no client is assigned to you yet. ShreeKrishna will assign one; this page opens up as soon as he does." />;
  const at = locate(path);
  const active = isOn(path, "/clients") ? "clients" : isOn(path, "/team") ? "team" : isOn(path, "/brain") ? "brain" : at.area === "home" ? "home" : at.area === "import" ? "import" : isOn(path, "/settings") ? "settings" : (at.section?.key ?? "");
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
                <Link key={r.key} href={r.href} className={`sh-item${active === r.key ? " on" : ""}${PHONE.includes(r.key) ? "" : " sh-desk"}`} data-tip={r.label} aria-label={r.label} aria-current={active === r.key ? "page" : undefined}>
                  <r.icon size={20} strokeWidth={1.9} aria-hidden />
                  <span className="sh-lbl">{r.short}</span>
                  {n > 0 && <span className="sh-badge tnum" aria-label={`${n} waiting`}>{n > 99 ? "99+" : n}</span>}
                </Link>
              );
            })}
            {access && (access.choices.length > 1 || sup || access.canSuperAdmin) && <AccountsNav choices={access.choices} picked={access.picked} on={active === "clients"} />}
          </div>
          <div className="sh-rail-foot">
            {sup && <span className="sh-mode-tag sh-desk" title="Super Admin mode: every account is visible"><ShieldCheck size={13} aria-hidden /><span className="sh-lbl">Super Admin mode</span></span>}
            {sup && <Link href="/team" className={`sh-item${active === "team" ? " on" : ""}`} data-tip="Team & Access" aria-label="Team & Access"><Users size={20} strokeWidth={1.9} aria-hidden /><span className="sh-lbl">Team &amp; Access</span></Link>}
            <Link href="/settings" className={`sh-item${active === "settings" ? " on" : ""}`} data-tip="Settings" aria-label="Settings"><Settings2 size={20} strokeWidth={1.9} aria-hidden /><span className="sh-lbl">Settings</span></Link>
            {access && <AccountMenu access={access} sup={sup} />}
          </div>
          <MoreSheet active={active} sup={sup} counts={counts} />
        </nav>
        <div className="sh-body" id="sh-scroll">
          {sup && (
            <div className="sh-super" role="status">
              <ShieldCheck size={16} /> <b>Super Admin mode</b> <span className="hide-sm">You can see and open every account, and change team and access. Every action is logged.</span>
              <Link href="/team" className="sh-super-link">Team & Access</Link>
              <form action={switchModeAction.bind(null, "user")}><button type="submit" className="sh-super-btn">Switch to User</button></form>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}


/** Name, client, Super Admin switch and sign out, behind the person's initials. */
function AccountMenu({ access, sup }: { access: NonNullable<Access>; sup: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const initials = access.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <div className="sh-acct" ref={ref}>
      <button type="button" className="sh-item sh-acct-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${access.name}`} data-tip="Account" onClick={() => setOpen(!open)}>
        <span className={`sh-av${sup ? " sup" : ""}`} aria-hidden>{initials}</span><span className="sh-lbl">{access.name.split(" ")[0] || "Account"}</span>
      </button>
      {open && (
        <div className="sh-menu" role="menu">
          <div className="sh-menu-who"><b>{access.name}</b><span>{access.email}</span>{access.clients.length > 0 && <span>{access.clients.join(", ")}</span>}{sup && <span className="sh-menu-sup"><ShieldCheck size={12} /> Super Admin on</span>}</div>
          {access.canSuperAdmin && (
            <form action={switchModeAction.bind(null, sup ? "user" : "super")}>
              <button type="submit" role="menuitem" className="sh-menu-i"><ShieldCheck size={15} /> {sup ? "Switch to User" : "Switch to Super Admin"}</button>
            </form>
          )}
          <Link href="/settings" role="menuitem" className="sh-menu-i" onClick={() => setOpen(false)}><Settings2 size={15} /> Settings</Link>
          <div className="sh-menu-sep" />
          <form action={signOutAction}><button type="submit" role="menuitem" className="sh-menu-i danger"><LogOut size={15} /> Sign out</button></form>
        </div>
      )}
    </div>
  );
}

/** Phone only: the fifth bar item opens everything that doesn't fit in the bar. */
function MoreSheet({ active, sup, counts }: { active: string; sup: boolean; counts: Counts }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  const rest = RAIL.filter((r) => !PHONE.includes(r.key));
  const n = rest.reduce((t, r) => t + (r.count ? counts[r.count] : 0), 0);
  return (
    <>
      <button type="button" className={`sh-item sh-more${open || rest.some((r) => r.key === active) ? " on" : ""}`} aria-expanded={open} aria-label="More" onClick={() => setOpen(!open)}>
        <MoreHorizontal size={20} strokeWidth={1.9} aria-hidden /><span className="sh-lbl">More</span>
        {n > 0 && <span className="sh-badge tnum">{n}</span>}
      </button>
      {open && (
        <div className="sh-sheet" role="dialog" aria-label="More">
          <div className="sh-sheet-h"><b>More</b><button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button></div>
          <div className="sh-sheet-g">
            {rest.map((r) => <Link key={r.key} href={r.href} className={`sh-sheet-i${active === r.key ? " on" : ""}`}><r.icon size={18} aria-hidden />{r.label}{r.count && counts[r.count] > 0 && <span className="sh-badge tnum">{counts[r.count]}</span>}</Link>)}
            <Link href="/clients" className={`sh-sheet-i${active === "clients" ? " on" : ""}`}><LayoutGrid size={18} aria-hidden />Accounts</Link>
            {sup && <Link href="/team" className="sh-sheet-i"><Users size={18} aria-hidden />Team &amp; Access</Link>}
            <Link href="/settings" className="sh-sheet-i"><Settings2 size={18} aria-hidden />Settings</Link>
          </div>
          <form action={signOutAction} className="sh-sheet-out"><button type="submit" className="btn btn-secondary btn-sm"><LogOut size={14} /> Sign out</button></form>
        </div>
      )}
    </>
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

/** Accounts, its own sidebar section: open it to see every account you can work on, click one to switch. */
function AccountsNav({ choices, picked, on }: { choices: { id: string; name: string; logoUrl?: string | null }[]; picked: string | null; on: boolean }) {
  const [open, setOpen] = useState(on);
  useEffect(() => {
    try {
      if (localStorage.getItem("abm:accounts-open") === "1") setOpen(true);
    } catch {}
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem("abm:accounts-open", o ? "0" : "1"); } catch {}
      return !o;
    });
  };
  const current = choices.find((c) => c.id === picked);
  return (
    <div className={`sh-accts sh-desk${open ? " open" : ""}`}>
      {/* Narrow rail (icons only): the icon opens the Accounts page. */}
      <Link href="/clients" className={`sh-item sh-accts-icon${on ? " on" : ""}`} data-tip="Accounts" aria-label="Accounts"><LayoutGrid size={20} strokeWidth={1.9} aria-hidden /><span className="sh-lbl">Accounts</span></Link>
      {/* Wide rail: a section that opens to list the accounts. */}
      <button type="button" className={`sh-item sh-accts-toggle${on ? " on" : ""}`} aria-expanded={open} aria-controls="sh-accts-list" onClick={toggle}>
        <LayoutGrid size={20} strokeWidth={1.9} aria-hidden />
        <span className="sh-lbl">Accounts</span>
        {current && !open && <span className="sh-accts-cur" title={`Open now: ${current.name}`}><AccountLogo name={current.name} url={current.logoUrl} className="sh-accts-av" /></span>}
        <ChevronDown size={14} className="sh-accts-chev" aria-hidden />
      </button>
      {open && (
        <ul id="sh-accts-list" className="sh-accts-list">
          {choices.map((c) => (
            <li key={c.id}>
              <form action={switchClientAction.bind(null, c.id)}>
                <button type="submit" className={`sh-accts-opt${picked === c.id ? " on" : ""}`} aria-current={picked === c.id ? "true" : undefined} title={`Open ${c.name}`}>
                  <AccountLogo name={c.name} url={c.logoUrl} className="sh-accts-av" />
                  <span className="sh-accts-n">{c.name}</span>
                  {picked === c.id && <Check size={14} aria-hidden />}
                </button>
              </form>
            </li>
          ))}
          {choices.length > 1 && (
            <li>
              <form action={switchClientAction.bind(null, "all")}>
                <button type="submit" className={`sh-accts-opt sub${!picked ? " on" : ""}`}>All together{!picked && <Check size={14} aria-hidden />}</button>
              </form>
            </li>
          )}
          <li><Link href="/clients" className={`sh-accts-opt sub link${on ? " on" : ""}`}>All accounts</Link></li>
        </ul>
      )}
    </div>
  );
}
