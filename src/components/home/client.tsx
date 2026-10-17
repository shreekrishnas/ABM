"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Moon, Search, Sun } from "lucide-react";

/** Counts up from 0 once (600ms, ease-out); shows the final number straight away for reduced motion. */
export function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) return;
    done.current = true;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 600);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n.toLocaleString()}</>;
}

export function ThemePill() {
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
  return (
    <button type="button" className="hs-round" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
    </button>
  );
}

export function SearchPill() {
  const open = () => window.dispatchEvent(new Event("abm:palette"));
  return (
    <>
      <button type="button" className="hs-search" onClick={open} aria-label="Search (Ctrl+K)">
        <Search size={16} strokeWidth={2} />
        <span className="hs-search-ph">Search companies, contacts…</span>
        <kbd>⌘K</kbd>
      </button>
      <button type="button" className="hs-round hs-search-icon" onClick={open} aria-label="Search">
        <Search size={18} strokeWidth={2} />
      </button>
    </>
  );
}

const RANGES = [["today", "Today"], ["week", "Week"], ["all", "All"]] as const;

/** Today / Week / All for the activity table, kept in the URL. */
export function RangeToggle() {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const on = sp.get("range") ?? "week";
  return (
    <div className="hs-seg" role="tablist" aria-label="Time range">
      {RANGES.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={on === k} className={on === k ? "on" : ""} onClick={() => router.replace(`${path}?range=${k}`, { scroll: false })}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function RailLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  const path = usePathname();
  const on = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className={`hs-rail-item${on ? " on" : ""}`} data-tip={label} aria-label={label} aria-current={on ? "page" : undefined}>
      {children}
    </Link>
  );
}
