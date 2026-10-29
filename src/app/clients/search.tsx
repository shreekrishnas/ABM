"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Filters the account cards by name as you type (no server round trip). */
export function AccountSearch({ total, children }: { total: number; children: ReactNode }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(total);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-name]") ?? []);
    let n = 0;
    for (const el of items) {
      const hit = !q || (el.dataset.name ?? "").includes(q.trim().toLowerCase());
      el.hidden = !hit;
      if (hit) n++;
    }
    setShown(n);
  }, [q]);
  return (
    <>
      {total > 3 && (
        <label className="ac-search">
          <Search size={16} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" aria-label="Search accounts" />
          <span className="tnum">{shown} of {total}</span>
        </label>
      )}
      <ul ref={list} className="ac-grid">{children}</ul>
      {shown === 0 && <p className="ac-none">No account matches “{q}”.</p>}
    </>
  );
}
