// Precision helpers for research facts: how strong a source is, when the event happened,
// whether a page is about the right company, near-duplicate reports, and one confidence
// number per fact. All pure functions, so the pipeline, the backfill and the page agree.

import { companyMarks, plainText } from "@/lib/pipeline/gates";

const DAY = 86_400_000;

// ── Canonical URL: the same article under tracking links, AMP or www is one source ──

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|source$|cmp$|cid$|igshid|spm$|s_cid|ocid|share|amp$|output$)/i;

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    let path = u.pathname.replace(/\/amp(\/|$)/, "/").replace(/\.amp(\.html?)?$/, "$1").replace(/\/+$/, "");
    if (!path) path = "/";
    const q = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${q ? `?${q}` : ""}`;
  } catch {
    return url.trim();
  }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
  } catch {
    return "";
  }
};

// ── Source strength ──

/**
 * Pages on the company's own site are not all equal: a press release, investor page or
 * "about" page speaks for the company; a blog post or product page is marketing.
 */
export function ownSiteTier(path: string): "official" | "company_site" | "careers" {
  const p = path.toLowerCase();
  if (/career|jobs|vacanc|join-?us|work-?with-?us/.test(p)) return "careers";
  if (p === "/" || p === "" || /press|news(room)?|media|investor|annual-?report|financial|about|who-?we-?are|company|leadership|management|board|corporate|announcement|release/.test(p)) return "official";
  return "company_site";
}

/** Labels people see, strongest first. */
export const TIER_LABEL: Record<string, string> = {
  team: "Checked by the team",
  official: "Official",
  provider: "Data provider",
  press: "Press release",
  news: "News",
  company_site: "Company site",
  careers: "Careers page",
  review_site: "Review site",
  web: "Web page",
  mock: "Sample",
};

const TIER_POINTS: Record<string, number> = { team: 60, official: 45, provider: 40, press: 35, news: 30, company_site: 28, review_site: 22, careers: 22, web: 18, mock: 30 };

// ── Event date: when it happened, not when the page was published ──

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * The date a sentence gives for the event, if it states one: "12 March 2025", "March 12, 2025",
 * "March 2025", "2025-03-12", or "in 2023" (a past year only). Never later than `ref` (the page date).
 */
export function eventDateFrom(text: string | null | undefined, ref: Date): Date | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const found: Date[] = [];
  const add = (y: number, m: number, d: number) => {
    if (y < 1990 || y > ref.getUTCFullYear() + 1 || m < 0 || m > 11 || d < 1 || d > 31) return;
    found.push(new Date(Date.UTC(y, m, d)));
  };
  for (const x of t.matchAll(/\b(20\d\d|19\d\d)-(\d\d)-(\d\d)\b/g)) add(+x[1], +x[2] - 1, +x[3]);
  for (const x of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s+(\\d{4})\\b`, "g"))) add(+x[3], MONTHS.indexOf(x[2].slice(0, 3)), +x[1]);
  for (const x of t.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "g"))) add(+x[3], MONTHS.indexOf(x[1].slice(0, 3)), +x[2]);
  if (!found.length) for (const x of t.matchAll(new RegExp(`\\b${MONTH_RE},?\\s+(\\d{4})\\b`, "g"))) add(+x[2], MONTHS.indexOf(x[1].slice(0, 3)), 1);
  // A bare year counts only when it is in the past ("in 2023"): a page from this year saying "in 2026" adds nothing.
  if (!found.length) {
    for (const x of t.matchAll(/\b(?:in|since|during|by|from|of|fy)\s*'?(20\d\d)\b/g)) {
      const y = +x[1];
      if (y < ref.getUTCFullYear()) add(y, 6, 1);
    }
  }
  const valid = found.filter((d) => d.getTime() <= ref.getTime() + DAY);
  if (!valid.length) return null;
  // The latest date stated is the event (a sentence may also mention when something began).
  return new Date(Math.max(...valid.map((d) => d.getTime())));
}

// ── Right company ──

const LEGAL = /\b(pvt|private|ltd|limited|inc|incorporated|llp|llc|plc|corp|corporation|co|company|the|gmbh|ag|sa)\b\.?/g;
const squashName = (t: string) => t.toLowerCase().replace(/&/g, " and ").replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();
const wordIn = (hay: string, w: string) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(hay);

/**
 * Stricter than "some word of the name appears": the page must carry the company's full name
 * (legal suffixes aside), its domain, or its brand words (the first two distinctive words) as whole words.
 * "Trident" alone does not make a page about "Trident Auto Components".
 */
export function namesCompany(name: string, domain: string | null, page: { url: string; title: string; text: string }): { pass: boolean; reason: string } {
  const hay = ` ${squashName(`${page.title} ${plainText(page.text)}`)} `;
  const full = squashName(name);
  if (full && hay.includes(` ${full} `)) return { pass: true, reason: "Page names the company in full" };
  const d = domain?.toLowerCase().replace(/^www\./, "");
  if (d && (hostOf(page.url) === d || hostOf(page.url).endsWith(`.${d}`) || `${page.title} ${page.text}`.toLowerCase().includes(d))) return { pass: true, reason: "Page is on or names the company's domain" };
  // The brand is the first distinctive words ("Trident Auto" of "Trident Auto Components"); both must appear.
  const marks = companyMarks(name, null).slice(0, 2);
  if (!marks.length) return { pass: true, reason: "No distinctive name to check" };
  const present = marks.filter((m) => wordIn(hay, m));
  if (present.length === marks.length) return { pass: true, reason: "Page names the company" };
  return { pass: false, reason: present.length ? `Page mentions "${present.join(" ")}" but not ${name}` : `Page doesn't name ${name}` };
}

// ── Near-duplicate reports ──

const wordsOf = (t: string) => plainText(t).toLowerCase().replace(/[^a-z0-9% ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);

function shingles(t: string, n = 3): Set<string> {
  const w = wordsOf(t);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** 0–1: how much two sentences share, by three-word runs. Reworded syndications of one story score high. */
export function similarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const s of A) if (B.has(s)) shared++;
  return shared / Math.min(A.size, B.size);
}

export const SAME_REPORT = 0.6;

// ── Numbers that should agree (size, counts) ──

/** The headcount a sentence states ("about 5,200 employees", "a team of 800+"), if any. */
export function statedEmployees(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/(\d),(\d)/g, "$1$2");
  // A size band ("1001-5000 employees", LinkedIn style) counts as its lower end: never overstate.
  const band = t.match(/\b(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:employees|staff|people)\b/);
  if (band) {
    const n = parseInt(band[1], 10);
    return n > 0 && n < 5_000_000 ? n : null;
  }
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k|lakh|thousand)?\+?\s*(?:full[- ]time\s+)?(?:employees|staff|people|professionals|workforce|team members|associates)\b/) ?? t.match(/(?:workforce|headcount|team) of (?:over |about |around |nearly |more than )?(\d+(?:\.\d+)?)\s*(k|lakh|thousand)?/);
  if (!m) return null;
  const mult = m[2] === "k" || m[2] === "thousand" ? 1000 : m[2] === "lakh" ? 100_000 : 1;
  const n = Math.round(parseFloat(m[1]) * mult);
  return n > 0 && n < 5_000_000 ? n : null;
}

/** Two headcounts disagree when one is more than twice the other (ranges and rounding are normal). */
export const sizesDisagree = (a: number, b: number) => Math.max(a, b) / Math.max(1, Math.min(a, b)) > 2;

// ── Confidence per fact ──

export interface ConfidenceInput {
  sourceType: string;
  status: string;
  fullText: boolean;
  /** The date that counts: the event date when the sentence gives one. */
  publishedAt: Date;
  undated?: boolean;
  /** Independent reports of the same fact (copies of one story count once). */
  reports: number;
  freshDays: number;
  quoteExact?: boolean;
  hasQuote: boolean;
}

/**
 * 0–100, by code: source strength, independent reports, how much of the page was read,
 * whether the quote is word for word, and age against the freshness window.
 */
export function factConfidence(i: ConfidenceInput, now = new Date()): number {
  if (i.status === "invalid") return 0;
  if (i.sourceType === "team") return 95;
  let s = TIER_POINTS[i.sourceType] ?? 18;
  s += i.reports >= 3 ? 30 : i.reports === 2 ? 20 : 0;
  s += i.fullText ? 10 : 0;
  s += i.hasQuote ? (i.quoteExact ? 10 : 5) : 0;
  const age = (now.getTime() - i.publishedAt.getTime()) / DAY;
  if (i.undated) s -= 10;
  else if (age <= i.freshDays / 2) s += 5;
  if (age > i.freshDays) s -= 30;
  if (i.status === "conflicting") s = Math.min(s, 30);
  if (i.status === "stale") s = Math.min(s, 35);
  return Math.max(5, Math.min(99, Math.round(s)));
}

export const confidenceWord = (c: number) => (c >= 75 ? "High" : c >= 50 ? "Medium" : "Low");
