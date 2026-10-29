"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While the AI is investigating, refresh the page every few seconds so results appear. */
export function RefreshWhileResearching({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
