"use client";
// Ctrl/Cmd + J opens JARVIS, with the company you're looking at in focus.
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export function JarvisKey() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "j" || e.altKey || e.shiftKey) return;
      e.preventDefault();
      const company = path.match(/^\/accounts\/([^/?#]+)/)?.[1];
      router.push(company ? `/jarvis?a=${encodeURIComponent(company)}` : "/jarvis");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [path, router]);
  return null;
}
