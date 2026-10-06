"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Moon, Search, Sun } from "lucide-react";

const TITLES: [string, string, string][] = [
  ["/accounts", "Target accounts", "Every account, its tier, stage and score"],
  ["/brain", "AI Brain", "Plans, connects, checks and learns"],
  ["/pipeline", "Pipeline", "Thirteen stages, every gate logged"],
  ["/review", "Review queue", "Everything waiting on a person"],
  ["/outreach", "Outreach", "Sequences, drafts and sends"],
  ["/signals", "Signals", "Intent, visits and engagement"],
  ["/handoffs", "Sales handoffs", "Accounts ready for a rep"],
  ["/crm", "CRM", "System of record"],
  ["/analytics", "Analytics", "What the program is producing"],
  ["/import", "Import", "Bring accounts and contacts in"],
  ["/settings", "Settings", "Thresholds and policies"],
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Topbar() {
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

  const t = TITLES.find(([p]) => path.startsWith(p));
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
