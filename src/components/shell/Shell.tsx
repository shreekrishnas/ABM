"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, Handshake, Home as HomeIcon, LogOut, Send, Settings2, Sun, Upload } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { signOutAction } from "@/app/login/actions";
import { isOn, locate, type Counts } from "@/lib/nav";

// Rail entries: Home, Import, then the workspace sections. Active state follows the
// nav map, so every page inside a section lights its rail icon.
const RAIL = [
  { key: "home", href: "/", label: "Home", icon: HomeIcon },
  { key: "import", href: "/import", label: "Import", icon: Upload },
  { key: "today", href: "/work/today", label: "Today", icon: Sun },
  { key: "research", href: "/accounts", label: "Research", icon: Building2 },
  { key: "outreach", href: "/review", label: "Email drafting", icon: Send, count: "review" as const },
  { key: "sales", href: "/handoffs", label: "Sales", icon: Handshake, count: "handoffs" as const },
  { key: "insights", href: "/overview", label: "Insights", icon: BarChart3 },
];

/** The glass shell every signed-in page lives in: atmosphere → glass panel → rail + content. */
export function Shell({ counts, children }: { counts: Counts; children: React.ReactNode }) {
  const path = usePathname();
  if (path.startsWith("/login")) return <main id="main">{children}</main>;
  const at = locate(path);
  const active = at.area === "home" ? "home" : at.area === "import" ? "import" : isOn(path, "/settings") ? "settings" : (at.section?.key ?? "");
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
                  <r.icon size={20} strokeWidth={1.9} />
                  {n > 0 && <span className="sh-badge tnum">{n > 99 ? "99+" : n}</span>}
                </Link>
              );
            })}
          </div>
          <div className="sh-rail-foot">
            <Link href="/settings" className={`sh-item${active === "settings" ? " on" : ""}`} data-tip="Settings" aria-label="Settings"><Settings2 size={20} strokeWidth={1.9} /></Link>
            <form action={signOutAction}><button type="submit" className="sh-item" data-tip="Sign out" aria-label="Sign out"><LogOut size={20} strokeWidth={1.9} /></button></form>
          </div>
        </nav>
        <div className="sh-body" id="sh-scroll">{children}</div>
      </div>
    </div>
  );
}
