"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keyboard and click behaviour for list + preview screens:
 * J / K (or ↓ / ↑) move the selection, Enter opens the full page, Esc closes the preview.
 * Clicking anywhere on a row (not on its links or buttons) previews it.
 */
export function ListKeys() {
  const router = useRouter();
  useEffect(() => {
    const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row-select]")];
    const go = (el: HTMLElement | undefined) => {
      const href = el?.dataset.rowSelect;
      if (!href) return;
      router.push(href, { scroll: false });
      el.scrollIntoView({ block: "nearest" });
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const list = rows();
      if (!list.length) return;
      const i = list.findIndex((r) => r.hasAttribute("data-selected"));
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        go(list[Math.min(list.length - 1, i + 1)]);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        go(list[Math.max(0, i - 1)]);
      } else if (e.key === "Enter" && i >= 0) {
        document.querySelector<HTMLAnchorElement>("[data-peek-open]")?.click();
      } else if (e.key === "Escape") {
        document.querySelector<HTMLAnchorElement>("[data-peek-close]")?.click();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("a, button, input, label, select, textarea")) return;
      const row = t.closest<HTMLElement>("[data-row-select]");
      if (row) go(row);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [router]);
  return null;
}
