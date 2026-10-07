// Research question keys. Several deep-dive questions find buying triggers too, so
// "is this a trigger?" is answered here once instead of comparing to "trigger" everywhere.
// Client-safe.

/** Answers to these questions are buying triggers (they open the "why now"). */
export const TRIGGER_KEYS = ["trigger", "erp_program", "expansion", "leadership"] as const;
export const isTriggerKey = (key: string) => (TRIGGER_KEYS as readonly string[]).includes(key);

/** Questions the intake asks when an imported company is missing basic fields. */
export const GAP_KEYS = ["website", "firmographics"] as const;

export const QUESTION_LABEL: Record<string, string> = {
  trigger: "Recent trigger", owner_function: "Who owns onboarding", negative: "Negative news", tooling: "Systems in use",
  partner_network: "Partner network size", erp_program: "ERP / MDM programme", expansion: "Expansion", leadership: "Leadership change",
  compliance: "Compliance pressure", culture: "Culture", website: "Official website", firmographics: "Industry, size, country",
};
