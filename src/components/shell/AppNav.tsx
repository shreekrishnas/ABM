"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Globe, Moon, Search, Sun } from "lucide-react";
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
  // One breadcrumb: Home › area or section › page. The page's own header carries the title.
  const crumbs: { label: string; href: string }[] = path.startsWith("/brain") ? [{ label: "Account Brain", href: "/brain" }]
    : path.startsWith("/team") ? [{ label: "Team & Access", href: "/team" }]
    : path.startsWith("/settings") ? [{ label: "Settings", href: "/settings" }]
    : at.area === "import" ? trail
    : [...(at.section ? [{ label: at.section.label, href: sectionHref(at.section) }] : []), ...(at.page && at.page.label !== at.section?.label ? [{ label: at.page.label, href: at.page.href }] : [])];
  const siblings = at.area === "import" ? (path === "/import" ? [] : IMPORT_PAGES) : at.section && at.section.items.length > 1 ? at.section.items : [];
  const sectionCount = (items: (typeof SECTIONS)[number]["items"]) => items.reduce((n, it) => n + (it.count ? counts[it.count] : 0), 0);

  return (
    <header className="nav">
      <div className="nav-row">
        <nav className="nav-crumbs" aria-label="You are here">
          <ol>
            <li><Link href="/">Home</Link></li>
            {crumbs.map((c, i) => (
              <li key={c.href + i}>
                <ChevronRight size={13} aria-hidden />
                {i === crumbs.length - 1 ? <span aria-current="page" title={c.label}>{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
              </li>
            ))}
          </ol>
        </nav>

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
        </div>
      </div>

      {siblings.length > 0 && (
        <nav className="nav-sub" aria-label="Pages here">
          {siblings.map((it) => {
            // The most specific sibling wins: /accounts/coverage lights Coverage, not Companies too.
            const on = isOn(path, it.href) && !siblings.some((o) => o.href.length > it.href.length && isOn(path, o.href));
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
