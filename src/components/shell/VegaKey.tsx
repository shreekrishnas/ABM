"use client";
// Ctrl/Cmd + J opens Vega in place: the panel on this page, with the company you're looking at in
// focus (the Vega button and the core on Home listen for it). On /vega itself it does nothing.
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { VEGA_OPEN_EVENT } from "@/components/vega/panel";

export function VegaKey() {
  const path = usePathname();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "j" || e.altKey || e.shiftKey) return;
      if (path.startsWith("/vega")) return;
      e.preventDefault();
      window.dispatchEvent(new Event(VEGA_OPEN_EVENT));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [path]);
  return null;
}
