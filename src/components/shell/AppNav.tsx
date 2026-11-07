"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Globe, Moon, Search, Sun } from "lucide-react";
import { locate, sectionHref, type Counts } from "@/lib/nav";
import { NotificationBell } from "./NotificationBell";

/**
 * Top bar: breadcrumb (module › page), the module's pages underneath, search, Discover,
 * theme and notifications. The modules themselves are in the sidebar.
 * Everything opens in this tab; only the URL changes.
 */
export function AppNav({ counts, discover, sellerName, account }: { counts: Counts; discover: number; sellerName: string; account?: { name: string; many: boolean; choices: { id: string; name: string }[]; picked: string | null; everyClient: boolean } | null }) {
  const path = usePathname();
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("abm-theme", next ? "dark" : "light");
    } catch {}
  };

  const at = locate(path);
  // Home draws its own shell (rail + topbar).
  if (at.area === "home" || path.startsWith("/login")) return null;
  // One breadcrumb: module › page. The page's own header carries the title.
  const crumbs: { label: string; href: string }[] = [
    ...(at.section ? [{ label: at.section.label, href: sectionHref(at.section) }] : []),
    ...(at.page && at.page.label !== at.section?.label && at.page.href !== sectionHref(at.section!) ? [{ label: at.page.label, href: at.page.href }] : []),
  ];
  const siblings = at.section && at.section.items.length > 1 ? at.section.items : [];

  return (
    <header className="nav">
      <div className="nav-row">
        <nav className="nav-crumbs" aria-label="You are here">
          <ol>
            {account?.many ? (
              <>
                <li><Link href="/clients">Accounts</Link></li>
                {path !== "/clients" && <li><ChevronRight size={13} aria-hidden /><Link href="/">{account.name}</Link></li>}
              </>
            ) : <li><Link href="/">Home</Link></li>}
            {crumbs.map((c, i) => (
              <li key={c.href + i}>
                <ChevronRight size={13} aria-hidden />
                {i === crumbs.length - 1 ? <span aria-current="page" title={c.label}>{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
              </li>
            ))}
          </ol>
        </nav>

        <div className="nav-tools">
          <button type="button" className="nav-search" onClick={() => window.dispatchEvent(new Event("abm:palette"))} aria-label="Search (Ctrl+K)">
            <Search size={15} strokeWidth={1.75} />
            <span className="hide-sm">Search</span>
            <kbd className="hide-sm">⌘K</kbd>
          </button>
          <Link href="/discover" className={`nav-icon${path.startsWith("/discover") ? " on" : ""}`} aria-label={`Discover${discover ? ` (${discover} suggested)` : ""}`} title="Discover new companies">
            <Globe size={17} strokeWidth={1.75} />
            {discover > 0 && <span className="nav-dotcount tnum">{discover > 99 ? "99+" : discover}</span>}
          </Link>
          <button type="button" className="nav-icon" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
            {dark ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
          </button>
          <NotificationBell />
        </div>
      </div>

      {siblings.length > 0 && (
        <nav className="nav-sub" aria-label="Pages here">
          {siblings.map((it) => {
            // The most specific sibling wins: /accounts/coverage lights Coverage, not Companies too.
            const on = it === at.page;
            const n = it.count ? counts[it.count] : 0;
            return (
              <Link key={it.href} href={it.href} className={`nav-page${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                <it.icon size={15} strokeWidth={1.75} />
                {it.label}
                {n > 0 && <span className={`nav-count tnum${it.count === "review" ? " alert" : ""}`}>{n}</span>}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}

