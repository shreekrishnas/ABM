"use client";

import { useEffect } from "react";
import { ListKeys } from "./list-keys";

/** Approvals: A approves, R rejects (plus J/K to move through the queue). Never while typing in the email. */
export function ApprovalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      if (k === "a") document.querySelector<HTMLButtonElement>("[data-approve] button")?.click();
      if (k === "r") document.querySelector<HTMLButtonElement>("[data-reject] button")?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <ListKeys />;
}
