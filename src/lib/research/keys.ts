// Research question keys. Which answers count as buying triggers, and what each
// question is called, come from the active seller pack.

import { seller } from "@/lib/seller";

/** Answers to these questions are buying triggers (they open the "why now"). "trigger" always is. */
export function isTriggerKey(key: string): boolean {
  return key === "trigger" || seller().researchQuestions.some((q) => q.key === key && q.trigger);
}

/** Questions the intake asks when an imported company is missing basic fields (generic). */
export const GAP_KEYS = ["website", "firmographics"] as const;

const GENERIC_LABEL: Record<string, string> = { website: "Official website", firmographics: "Industry, size, country", negative: "Negative news", trigger: "Recent trigger" };

export function questionLabel(key: string): string {
  return seller().researchQuestions.find((q) => q.key === key)?.label ?? GENERIC_LABEL[key] ?? key.replace(/_/g, " ");
}
