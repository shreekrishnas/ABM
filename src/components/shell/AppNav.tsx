"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FileSpreadsheet, Globe, Globe2, Moon, Search, Sparkles, Sun } from "lucide-react";
import { GROUPS } from "./Sidebar";

type Counts = { review: number; handoffs: number; tasks: number };

const isOn = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

const IMPORT_PAGES = [
  { href: "/import/upload", label: "Upload CSV", icon: FileSpreadsheet },
  { href: "/import/lookalikes", label: "Lookalikes", icon: Sparkles },
  { href: "/import/apollo", label: "Via Apollo", icon: Globe2 },
];

/**
 * Layered top navigation: Home (/) › Import data or Workspace › section › page › item.
 * Everything opens in this tab; only the URL changes.
 */
export function AppNav({ counts, discover, sellerName }: { counts: Counts; discover: number; sellerName: string }) {
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

  const home = path === "/";
  const importing = isOn(path, "/import");
  const group = GROUPS.find((g) => g.items.some((it) => isOn(path, it.href))) ?? GROUPS[0];
  const groupCount = (g: (typeof GROUPS)[number]) => g.items.reduce((n, it) => n + (it.count ? counts[it.count] : 0), 0);
  const initials = sellerName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <header className="nav">
      <div className="nav-row">
        <Link href="/" className="nav-brand" aria-label="Home">
          <span className="nav-mark" aria-hidden>{initials}</span>
          <span className="nav-brand-text">
            <span className="nav-brand-name">{sellerName}</span>
            <span className="nav-brand-sub">Account intelligence</span>
          </span>
        </Link>

        {!home && (
          <nav className="nav-modes" aria-label="Areas">
            <Link href="/import" className={`nav-mode${importing ? " on" : ""}`} aria-current={importing ? "true" : undefined}>Import data</Link>
            <Link href="/work" className={`nav-mode${!importing ? " on" : ""}`} aria-current={!importing ? "true" : undefined}>Workspace</Link>
          </nav>
        )}

        {!home && !importing && <nav className="nav-sections" aria-label="Sections">
          {GROUPS.map((g) => {
            const label = g.label || "Today";
            const href = g.items[0].href;
            const on = g === group;
            const n = groupCount(g);
            return (
              <Link key={label} href={href} className={`nav-section${on ? " on" : ""}`} aria-current={on ? "true" : undefined}>
                {label}
                {n > 0 && <span className="nav-count tnum">{n > 99 ? "99+" : n}</span>}
              </Link>
            );
          })}
        </nav>}

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
        </div>
      </div>

      {importing && (
        <nav className="nav-sub" aria-label="Import options">
          {IMPORT_PAGES.map((it) => {
            const on = isOn(path, it.href);
            return (
              <Link key={it.href} href={it.href} className={`nav-page${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                <it.icon size={15} strokeWidth={1.75} />
                {it.label}
              </Link>
            );
          })}
        </nav>
      )}

      {!home && !importing && group.items.length > 1 && (
        <nav className="nav-sub" aria-label={`${group.label} pages`}>
          {group.items.map((it) => {
            const on = isOn(path, it.href);
            const n = it.count ? counts[it.count] : 0;
            const Icon = it.icon;
            return (
              <Link key={it.href} href={it.href} className={`nav-page${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                <Icon size={15} strokeWidth={1.75} />
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
