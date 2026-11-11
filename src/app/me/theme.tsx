"use client";

import { useEffect, useState } from "react";

/** Light, dark or follow the computer; kept in this browser. */
export function ThemeChoice() {
  const [v, setV] = useState("system");
  useEffect(() => { try { setV(localStorage.getItem("abm-theme") ?? "system"); } catch {} }, []);
  const pick = (t: string) => {
    setV(t);
    try { if (t === "system") localStorage.removeItem("abm-theme"); else localStorage.setItem("abm-theme", t); } catch {}
    const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
  };
  return (
    <div className="k-seg tm-tabs" role="group" aria-label="Theme">
      {[["light", "Light"], ["dark", "Dark"], ["system", "Match my computer"]].map(([k, l]) => <button key={k} type="button" className={v === k ? "on" : undefined} aria-pressed={v === k} onClick={() => pick(k)}>{l}</button>)}
    </div>
  );
}
