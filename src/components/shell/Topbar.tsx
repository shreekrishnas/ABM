"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Moon, Search, Sun } from "lucide-react";

const TITLES: [string, string, string][] = [
  ["/accounts", "Companies", "Who to focus on, and why now"],
  ["/people", "People", "Every prospect and their journey with us"],
  ["/pipeline", "Behind the scenes", "Every step the brain took, and why"],
  ["/review", "Approvals", "Things only a person can decide"],
  ["/outreach", "Emails", "Every email as a conversation"],
  ["/signals", "Signals", "Visits, clicks and intent"],
  ["/handoffs", "Hand-offs to sales", "Accounts ready for a rep"],
  ["/crm", "CRM", "Opportunities and tasks"],
  ["/overview", "Program overview", "What the program is producing"],
  ["/analytics", "Analytics", "What is working"],
  ["/import", "Import companies & people", "One file in; research and journeys follow"],
  ["/discover", "Discover", "New companies and rising industries"],
  ["/settings", "Settings", "Seller, rules and connections"],
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Topbar({ discover = 0 }: { discover?: number }) {
  const path = usePathname();
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [q, setQ] = useState("");
  const [hello, setHello] = useState("Welcome back");

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    setHello(greeting());
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("abm-theme", next ? "dark" : "light");
    } catch {}
  };

  const t: [string, string, string] | undefined = path === "/" ? ["/", "Today", "Only what needs a person"] : TITLES.find(([p]) => path.startsWith(p));
  return (
    <header className="topbar">
      <div className="min-w-0">
        <div className="truncate text-[1.05rem] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t ? t[1] : hello}</div>
        <div className="muted truncate text-xs">{t ? t[2] : "Here is where your target accounts stand today"}</div>
      </div>
      <div className="flex items-center gap-3">
        <form
          className="search-pill hide-sm w-72"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/accounts?q=${encodeURIComponent(q)}`);
          }}
        >
          <Search size={16} />
          <input className="glass-input" placeholder="Search accounts, domains…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        </form>
        <Link href="/discover" className={`round-control relative${path.startsWith("/discover") ? " is-active" : ""}`} aria-label={`Discover new companies${discover ? ` (${discover} suggested)` : ""}`} title="Discover: new companies and rising industries">
          <Globe size={18} />
          {discover > 0 && <span className="topbar-badge tnum">{discover > 99 ? "99+" : discover}</span>}
        </Link>
        <button className="round-control" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="pill-control hide-sm">
          <span className="grid h-7 w-7 place-items-center rounded-full text-[0.7rem] font-bold text-white" style={{ background: "linear-gradient(135deg,#6366F1,#4F46E5)" }}>JT</span>
          <span style={{ color: "var(--text-primary)" }}>Jess Taylor</span>
          <span className="text-[0.7rem] font-bold" style={{ backgroundImage: "linear-gradient(135deg,#818CF8,#4F46E5)", WebkitBackgroundClip: "text", color: "transparent" }}>Marketer</span>
        </div>
      </div>
    </header>
  );
}
