"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Globe, LogOut, Moon, Search, Sun } from "lucide-react";
import { signOutAction } from "@/app/login/actions";
import { Logo } from "@/components/brand/Logo";
import { IMPORT_PAGES, SECTIONS, isOn, locate, sectionHref, type Counts } from "@/lib/nav";

/**
 * Top bar. Import data: a trail (Home › Import data › option) and the options underneath.
 * Workspace: section tabs, with the section's pages underneath.
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
  // Home draws its own shell (rail + topbar).
  if (at.area === "home" || path.startsWith("/login")) return null;
  const trail: { label: string; href: string }[] = [];
  if (at.area === "import") {
    trail.push({ label: "Import data", href: "/import" });
    if (at.page) trail.push({ label: at.page.label, href: at.page.href });
  }
  const siblings = at.area === "import" ? (path === "/import" ? [] : IMPORT_PAGES) : at.section && at.section.items.length > 1 ? at.section.items : [];
  const sectionCount = (items: (typeof SECTIONS)[number]["items"]) => items.reduce((n, it) => n + (it.count ? counts[it.count] : 0), 0);

  return (
    <header className="nav">
      <div className="nav-row">
        <Link href="/" className="nav-brand" aria-label="Home">
          <Logo size={34} sub="Account intelligence" />
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

        {at.area === "work" && (
          <nav className="nav-sections" aria-label="Workspace sections">
            {SECTIONS.map((g) => {
              const on = g === at.section;
              const n = sectionCount(g.items);
              return (
                <Link key={g.key} href={sectionHref(g)} className={`nav-section${on ? " on" : ""}`} aria-current={on ? "true" : undefined}>
                  {g.label}
                  {n > 0 && <span className="nav-count tnum">{n > 99 ? "99+" : n}</span>}
                </Link>
              );
            })}
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
          <form action={signOutAction}>
            <button type="submit" className="nav-icon" aria-label="Sign out" title="Sign out"><LogOut size={17} strokeWidth={1.75} /></button>
          </form>
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
