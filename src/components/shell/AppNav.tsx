"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Globe, Moon, Search, Sun } from "lucide-react";
import { IMPORT_PAGES, isOn, locate, sectionHref, type Counts } from "@/lib/nav";

/**
 * Top bar for the drill-down: Home › Import data | Workspace › section › page.
 * The trail is the way up; the row underneath holds the pages next to this one.
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

  const at = locate(path);
  const trail: { label: string; href: string }[] = [];
  if (at.area === "import") {
    trail.push({ label: "Import data", href: "/import" });
    if (at.page) trail.push({ label: at.page.label, href: at.page.href });
  } else if (at.area === "work") {
    trail.push({ label: "Workspace", href: "/work" });
    if (at.section) trail.push({ label: at.section.label, href: sectionHref(at.section) });
    if (at.page && at.section && at.section.items.length > 1) trail.push({ label: at.page.label, href: at.page.href });
  }
  const siblings = at.area === "import" ? (path === "/import" ? [] : IMPORT_PAGES) : at.section && at.section.items.length > 1 && at.page ? at.section.items : [];
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

        {trail.length > 0 && (
          <nav className="nav-trail" aria-label="You are here">
            <ol>
              <li><Link href="/">Home</Link></li>
              {trail.map((t, i) => (
                <li key={t.href}>
                  <ChevronRight size={14} aria-hidden />
                  {i === trail.length - 1 && t.href === path ? <span aria-current="page">{t.label}</span> : <Link href={t.href}>{t.label}</Link>}
                </li>
              ))}
            </ol>
          </nav>
        )}

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

      {siblings.length > 0 && (
        <nav className="nav-sub" aria-label="Pages here">
          {siblings.map((it) => {
            const on = isOn(path, it.href);
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
