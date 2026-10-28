// Before any conclusion is trusted: was the research complete enough? Each check is a plain
// rule with a reason. A numeric score could help triage, but these gates decide. A capped or
// budget-limited run with gaps is "incomplete", never a negative conclusion.

import { independentReports } from "@/lib/pipeline/gates";
import type { Classification } from "./research-types";

export interface CompletenessInput {
  /** High-importance baseline questions (from the research plan). */
  requiredKeys: string[];
  /** Questions actually searched without error. */
  searchedKeys: string[];
  /** Questions with at least one usable, fresh fact. */
  answeredKeys: string[];
  hypotheses: { id: string; classification: Classification; supportIds: string[]; counterIds: string[] }[];
  /** Hypothesis ids a disconfirming question was asked about. */
  disconfirmAsked: string[];
  facts: Record<string, { sourceUrl: string; fingerprint: string | null; stale: boolean; status: string }>;
  /** High-value questions proposed but never asked (cap or budget). */
  unasked: string[];
  capped: boolean;
  budgetHit: boolean;
}

export interface Completeness {
  complete: boolean;
  checks: { key: string; label: string; pass: boolean; detail: string }[];
  gaps: string[];
  nextQuestions: string[];
}

const CONCLUSIONS: Classification[] = ["supported_opportunity", "direct_intent"];
const RELEVANT: Classification[] = ["relevant_development", "supported_opportunity", "direct_intent"];

export function assessCompleteness(i: CompletenessInput): Completeness {
  const checks: Completeness["checks"] = [];
  const add = (key: string, label: string, pass: boolean, detail: string) => checks.push({ key, label, pass, detail });

  const notSearched = i.requiredKeys.filter((k) => !i.searchedKeys.includes(k));
  add("baseline", "Baseline questions searched", notSearched.length === 0, notSearched.length ? `Not searched: ${notSearched.join(", ")}` : `${i.requiredKeys.length} baseline question(s) searched`);

  const relevant = i.hypotheses.filter((h) => RELEVANT.includes(h.classification));
  const unchallenged = relevant.filter((h) => !i.disconfirmAsked.includes(h.id) && h.counterIds.length === 0);
  add("counterevidence", "Counter-evidence looked for", unchallenged.length === 0, unchallenged.length ? `${unchallenged.length} relevant hypothesis/es never challenged` : relevant.length ? "Every relevant hypothesis was challenged" : "No relevant hypothesis to challenge");

  const conclusions = i.hypotheses.filter((h) => CONCLUSIONS.includes(h.classification));
  const unsupported = conclusions.filter((h) => !h.supportIds.some((id) => i.facts[id]));
  add("support", "Every conclusion rests on facts", unsupported.length === 0, unsupported.length ? `${unsupported.length} conclusion(s) without a supporting fact` : "Conclusions cite facts we hold");

  const thin = conclusions.filter((h) => h.classification !== "direct_intent" && independentReports(h.supportIds.map((id) => i.facts[id]).filter(Boolean)) < 2);
  add("diversity", "Independent sources", thin.length === 0, thin.length ? `${thin.length} conclusion(s) rest on one report (copies count once)` : "Conclusions have independent reports");

  const stale = conclusions.filter((h) => h.supportIds.some((id) => i.facts[id]?.stale));
  add("freshness", "Fresh evidence", stale.length === 0, stale.length ? `${stale.length} conclusion(s) lean on stale facts` : "Supporting facts are fresh");

  add("open_questions", "No high-value question left open", i.unasked.length === 0, i.unasked.length ? `${i.unasked.length} high-value question(s) not asked${i.capped ? " (round limit)" : i.budgetHit ? " (budget)" : ""}` : "Nothing important left unasked");

  const gaps = checks.filter((c) => !c.pass).map((c) => `${c.label}: ${c.detail}`);
  return { complete: gaps.length === 0, checks, gaps, nextQuestions: i.unasked.slice(0, 5) };
}
