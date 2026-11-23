// Research question keys. Which answers count as buying triggers, and what each
// question is called, come from the client's own seller pack: the one passed in, else the pack of
// the run in progress. Outside a run, pass the company's client pack (else the words would be the
// default client's).

import { seller, type SellerProfile } from "@/lib/seller";

type Questions = Pick<SellerProfile, "researchQuestions">;

/** Answers to these questions are buying triggers (they open the "why now"). "trigger" always is. */
export function isTriggerKey(key: string, pack: Questions = seller()): boolean {
  return key === "trigger" || pack.researchQuestions.some((q) => q.key === key && q.trigger);
}

/** Questions the intake asks when an imported company is missing basic fields (generic). */
export const GAP_KEYS = ["website", "firmographics"] as const;

const GENERIC_LABEL: Record<string, string> = { website: "Official website", firmographics: "Industry, size, country", negative: "Negative news", trigger: "Recent trigger" };

export function questionLabel(key: string, pack: Questions = seller()): string {
  return pack.researchQuestions.find((q) => q.key === key)?.label ?? GENERIC_LABEL[key] ?? key.replace(/_/g, " ");
}
