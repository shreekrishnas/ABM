// Pure helpers shared by the server and the editor in the browser (no database imports).

import type { SellerProfile } from "./types";

const SECTION_LABEL: Record<string, string> = {
  icp: "targeting & fit",
  messaging: "messaging",
  sender: "sender",
  tone: "tone",
  bannedClaims: "banned claims",
  autonomy: "approval",
  triggers: "buying triggers",
  proofPoints: "proof points",
  researchQuestions: "research questions",
  personas: "buying group",
  useCases: "use cases",
  customers: "reference customers",
  competitors: "competitors",
  negativeSignals: "negative signals",
  products: "products",
  ruleHints: "fallback wording",
  summary: "summary",
  positioning: "positioning",
};

/** JSON with object keys sorted, so the same content always gives the same string
 * (Postgres JSONB reorders keys, and editors may too). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const FIELD_LABEL: [RegExp, string][] = [
  [/^icp\.mustHave\.countries/, "Country"],
  [/^icp\.mustHave\.minEmployees/, "Minimum employees"],
  [/^icp\.geos\.primary/, "Primary market"],
  [/^icp\.geos\.secondary/, "Secondary market"],
  [/^icp\.employees/, "Company size"],
  [/^icp\.tierBySize/, "Tiers by size"],
  [/^sender\.address/, "Postal address"],
  [/^sender\.name/, "Signed by"],
  [/^sender\.company/, "Sender company"],
  [/^messaging\.cta/, "Call to action"],
  [/^messaging\.default/, "Default pitch"],
  [/^messaging\.byUseCase/, "Use-case pitch"],
  [/^tone/, "Tone rule"],
  [/^bannedClaims/, "Banned claim"],
  [/^triggers/, "Trigger"],
  [/^proofPoints/, "Proof point"],
];

/** "icp.mustHave.countries.1: use 2-letter…" → "Countries (item 2): use 2-letter…" for people. */
export function friendlyProblem(p: string): string {
  const m = p.match(/^([\w.]+): (.*)$/);
  if (!m) return p;
  const [, path, msg] = m;
  const hit = FIELD_LABEL.find(([re]) => re.test(path));
  if (!hit) return p;
  const idx = path.match(/\.(\d+)(?:\.|$)/);
  const leaf = /^(triggers|proofPoints)\.\d+\.(\w+)/.exec(path)?.[2];
  const nice = msg.replace(/^Too small: expected string to have >=1 characters$/i, "can't be empty").replace(/^Invalid input: expected (\w+), received (\w+)$/i, "expected a $1");
  return `${hit[1]}${idx ? ` ${Number(idx[1]) + 1}` : ""}${leaf ? ` (${leaf})` : ""}: ${nice}`;
}

export const sectionLabel = (k: string) => SECTION_LABEL[k] ?? k;

/** Top-level sections that differ between two packs. */
export function changedSections(before: SellerProfile, after: SellerProfile): string[] {
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => canonicalJson(a[k]) !== canonicalJson(b[k])).sort();
}
