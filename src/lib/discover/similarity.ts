// "Why similar": which traits a lookalike shares with the company it was found from, and a
// 0–100 score from them, so people can approve lookalikes with reasons instead of blind.

import { bucketOf } from "./scan";

export interface SeedProfile { industry: string | null; employees: number | null; country: string | null; keywords?: string[] }
export interface Trait { label: string; match: boolean | null; detail: string }

const WEIGHTS = { industry: 35, size: 25, country: 20, evidence: 20 };

/** Traits shared with the seed. match = null when either side is unknown (it neither adds nor subtracts). */
export function similarity(seed: SeedProfile | null, c: { industry: string | null; employees: number | null; country: string | null; whyNow: string; sources: unknown }): { score: number | null; traits: Trait[] } {
  if (!seed) return { score: null, traits: [] };
  const traits: Trait[] = [];
  let got = 0;
  let possible = 0;
  const add = (label: string, weight: number, match: boolean | null, detail: string) => {
    traits.push({ label, match, detail });
    if (match === null) return;
    possible += weight;
    if (match) got += weight;
  };

  const sameIndustry = seed.industry && c.industry ? bucketOf(seed.industry) === bucketOf(c.industry) && bucketOf(c.industry) !== "other" || seed.industry.toLowerCase() === c.industry.toLowerCase() : null;
  add("Industry", WEIGHTS.industry, sameIndustry, c.industry ? (sameIndustry ? c.industry : `${c.industry} vs ${seed.industry ?? "?"}`) : "unknown");

  const ratio = seed.employees && c.employees ? c.employees / seed.employees : null;
  const sameSize = ratio == null ? null : ratio >= 1 / 3 && ratio <= 3;
  add("Size", WEIGHTS.size, sameSize, c.employees != null ? `${c.employees.toLocaleString()} vs ${seed.employees?.toLocaleString() ?? "?"} employees` : "unknown");

  const sameCountry = seed.country && c.country ? seed.country.toUpperCase() === c.country.toUpperCase() : null;
  add("Country", WEIGHTS.country, sameCountry, c.country ?? "unknown");

  // Evidence: found by Apollo's same-profile search, or named as a peer on a page.
  const named = Array.isArray(c.sources) && c.sources.length > 0;
  const apollo = /same profile in apollo/i.test(c.whyNow);
  add(apollo ? "Same profile in Apollo" : named ? "Named as a peer" : "Found by search", WEIGHTS.evidence, apollo || named, apollo ? "matching keywords" : named ? "quoted on a page" : "no direct evidence");

  return { score: possible ? Math.round((got / possible) * 100) : null, traits };
}
