// Pure gate functions. Every gate returns a decision with a reason so the caller
// can log it — nothing is ever dropped silently.

import { CONFIG } from "@/lib/config";
import { isTriggerKey } from "@/lib/research/keys";
import type { BuyingRole, FieldStatus, ReadinessOutcome, ReplyClass, Relationship, Tier } from "@prisma/client";
import { emailDomain } from "./normalize";
import { seller } from "@/lib/seller";

export interface GateResult {
  pass: boolean;
  reason: string;
}

const DAY = 86_400_000;
export const daysBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / DAY;

// ── Stage 3: exclusions ──

export interface ExclusionInput {
  relationship: Relationship;
  doNotContact: boolean;
  openOpportunity: boolean;
  lastLostAt: Date | null;
  now?: Date;
}

export function exclusionGate(i: ExclusionInput): GateResult {
  const now = i.now ?? new Date();
  if (i.relationship === "customer") return { pass: false, reason: "Existing customer" };
  if (i.relationship === "competitor") return { pass: false, reason: "Competitor" };
  if (i.relationship === "partner") return { pass: false, reason: "Partner — route through partner team" };
  if (i.doNotContact) return { pass: false, reason: "Marked do-not-contact by the account owner" };
  if (i.openOpportunity) return { pass: false, reason: "Open opportunity — sales already engaged" };
  if (i.lastLostAt && daysBetween(now, i.lastLostAt) < CONFIG.fit.lostDealCooldownDays)
    return { pass: false, reason: `Deal lost ${Math.round(daysBetween(now, i.lastLostAt))} days ago (cooldown ${CONFIG.fit.lostDealCooldownDays})` };
  return { pass: true, reason: "No exclusion applies" };
}

/**
 * The seller's hard targeting rules (e.g. India, more than 5,000 employees).
 * Known and failing → excluded. Unknown → stop without spending, until the data arrives.
 */
export function mustHaveGate(a: { country: string | null; employees: number | null }, rule = seller().icp.mustHave): GateResult & { unknown?: boolean } {
  if (!rule) return { pass: true, reason: "No hard targeting rules" };
  const missing: string[] = [];
  if (rule.countries?.length) {
    if (!a.country) missing.push("country");
    else if (!rule.countries.includes(a.country.toUpperCase())) return { pass: false, reason: `Outside target countries (${a.country}; must be ${rule.countries.join(" or ")})` };
  }
  if (rule.minEmployees) {
    if (a.employees == null) missing.push("employee size");
    else if (a.employees < rule.minEmployees) return { pass: false, reason: `Too small (${a.employees.toLocaleString()} employees; must be more than ${(rule.minEmployees - 1).toLocaleString()})` };
  }
  if (missing.length) return { pass: false, unknown: true, reason: `Can't confirm ${missing.join(" and ")} — add it to the next upload` };
  return { pass: true, reason: "Meets the targeting rules" };
}

export function fitFloorGate(fit: number | null): GateResult {
  if (fit === null) return { pass: true, reason: "No firmographics known — research decides" };
  return fit >= CONFIG.fit.floor ? { pass: true, reason: `Fit ${fit} ≥ ${CONFIG.fit.floor}` } : { pass: false, reason: `Fit ${fit} below floor ${CONFIG.fit.floor}` };
}

// ── Freshness ──

export type FreshnessKind = keyof typeof CONFIG.freshnessDays;

export function isStale(observedAt: Date | null | undefined, kind: FreshnessKind, now = new Date()): boolean {
  if (!observedAt) return false;
  return daysBetween(now, observedAt) > CONFIG.freshnessDays[kind];
}

// ── Stage 4: identity ──

export function emailDomainStatus(email: string | null, companyDomain: string | null): { status: FieldStatus; reason: string } {
  if (!email) return { status: "unknown", reason: "No email" };
  const d = emailDomain(email);
  if (!d) return { status: "invalid", reason: "Malformed email" };
  if ((CONFIG.personalDomains as readonly string[]).includes(d)) return { status: "conflicting", reason: `Personal address (${d})` };
  if (!companyDomain) return { status: "unknown", reason: "Company domain unknown" };
  if (d === companyDomain || d.endsWith(`.${companyDomain}`)) return { status: "probable", reason: "Email domain matches company" };
  // The company's other domains: same name, another ending (acme.net for acme.in) or a regional one (acmeusa.com).
  const root = (x: string) => x.split(".")[0];
  if (root(companyDomain).length >= 4 && (root(d) === root(companyDomain) || root(d).startsWith(root(companyDomain)))) return { status: "probable", reason: `Email on the company's other domain (${d})` };
  return { status: "conflicting", reason: `Email domain ${d} ≠ company ${companyDomain}` };
}

export function phoneCountryStatus(phoneCountry: string | null, companyCountry: string | null): FieldStatus {
  if (!phoneCountry || !companyCountry) return "unknown";
  return phoneCountry === companyCountry ? "probable" : "conflicting";
}

// ── Stage 6: evidence gate ──

export interface EvidenceDraft {
  key: string;
  claim: string;
  sourceUrl?: string | null;
  sourceType?: string | null;
  publishedAt?: Date | null;
}

export function evidenceGate(e: EvidenceDraft, adapterMode: "live" | "mock" = "mock"): GateResult {
  if (!e.sourceUrl || !/^https?:\/\//.test(e.sourceUrl)) return { pass: false, reason: "Missing source URL" };
  if (!e.sourceType) return { pass: false, reason: "Missing source type" };
  if (!e.publishedAt || Number.isNaN(e.publishedAt.getTime())) return { pass: false, reason: "Missing date" };
  if (e.publishedAt.getTime() > Date.now() + DAY) return { pass: false, reason: "Date is in the future" };
  if (adapterMode === "live" && e.sourceType === "mock") return { pass: false, reason: "Mock evidence refused in live mode" };
  return { pass: true, reason: "Source, type and date present" };
}

const squash = (t: string) => t.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^a-z0-9%$.,'"]+/g, " ").trim();

/** Page text as a reader sees it: markdown links, images, headings and table bars removed. */
export function plainText(t: string): string {
  return t
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_>|`~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (t: string) => squash(plainText(t)).replace(/[^a-z0-9%$ ]+/g, " ").split(/\s+/).filter(Boolean);

/**
 * How much of the quote appears on the page, in order, within a stretch about its own
 * length: 1 = word for word. Tolerates a dropped or changed word, never a sentence the
 * page doesn't contain.
 */
export function quoteMatch(quote: string, pageText: string): number {
  const q = words(quote);
  const p = words(pageText);
  if (!q.length || !p.length) return 0;
  if (` ${p.join(" ")} `.includes(` ${q.join(" ")} `)) return 1;
  const span = Math.ceil(q.length * 1.3) + 2;
  let best = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== q[0] && p[i] !== q[1]) continue;
    let k = 0;
    let matched = 0;
    for (let j = i; j < Math.min(p.length, i + span) && k < q.length; j++) {
      const hit = q.indexOf(p[j], k);
      if (hit !== -1 && hit - k <= 2) {
        matched++;
        k = hit + 1;
      }
    }
    best = Math.max(best, matched / q.length);
    if (best === 1) break;
  }
  return best;
}

/** Near enough to word for word: most of the quote, in order, in one place on the page. */
export const QUOTE_MATCH_MIN = 0.85;

/**
 * Truth before speed: a fact is kept only with a supporting quote that really appears on its
 * source page (word for word, or within a word or two). In live mode a missing quote drops the fact.
 */
export function quoteGate(quote: string | null | undefined, page: { title: string; text: string } | undefined, adapterMode: "live" | "mock" = "mock"): GateResult {
  if (!quote || quote.trim().length < 12) return adapterMode === "live" ? { pass: false, reason: "No supporting quote from the page" } : { pass: true, reason: "Sample data (no quote required)" };
  if (!page) return { pass: false, reason: "Source page not found for the quote" };
  const m = quoteMatch(quote, `${page.title} ${page.text}`);
  if (m === 1) return { pass: true, reason: "Exact quote found on the page" };
  // Words may differ slightly; numbers never (5,000 is not 3,000).
  const onPage = new Set(words(`${page.title} ${page.text}`));
  const numbersOk = words(quote).filter((w) => /\d/.test(w)).every((w) => onPage.has(w));
  if (m >= QUOTE_MATCH_MIN && numbersOk && words(quote).length >= 6) return { pass: true, reason: `Quote found on the page (${Math.round(m * 100)}% word for word)` };
  return { pass: false, reason: "Quote does not appear on the source page" };
}

const GENERIC = new Set("ltd limited pvt private inc corp corporation company co the and of group india indian industries industry pharmaceuticals pharmaceutical pharma drugs drug technologies technology tech solutions services labs laboratories lifesciences life sciences global international holdings enterprises foods food systems software healthcare consumer products manufacturing logistics ventures capital partners llp llc plc gmbh sa ag".split(" "));

/** The words that identify a company ("Acme Drugs & Pharmaceuticals" → acme), plus its domain name. */
export function companyMarks(name: string, domain: string | null): string[] {
  const words = squash(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
  const root = domain?.toLowerCase().replace(/^www\./, "").split(".")[0];
  return [...new Set([...words, ...(root && root.length >= 3 ? [root] : [])])];
}

/** Right company: the source must name it (by a distinctive word or its domain), or it is about someone else. */
export function entityGate(name: string, domain: string | null, page: { url: string; title: string; text: string } | undefined): GateResult {
  if (!page) return { pass: false, reason: "Source page not found" };
  const marks = companyMarks(name, domain);
  if (!marks.length) return { pass: true, reason: "No distinctive name to check" };
  const hay = ` ${squash(`${page.title} ${page.text} ${page.url}`)} `;
  return marks.some((m) => hay.includes(m)) ? { pass: true, reason: "Source names the company" } : { pass: false, reason: `Source doesn't name ${name}` };
}

// ── Source fidelity: does the claim say what its quote says? ──

const NUM = /\d[\d,.]*/g;
const normNum = (n: string) => n.replace(/[,]/g, "").replace(/\.$/, "");
const FIDELITY_STOP = new Set("the a an and or of to in on for with at by from as is are was were be been has have had its it this that their they will would can could also into over under about after before than more most new company said says announced".split(" "));

/**
 * The model writes the claim; the quote is what the page says. The claim may not add numbers
 * the quote lacks, must share its key words with the quote, and the quote (or its paragraph)
 * must be about this company — not a rival named on the same page.
 */
export function claimFidelity(claim: string, quote: string, marks: string[], passage?: string | null): GateResult {
  const qWords = new Set(words(quote));
  const claimNums = (claim.match(NUM) ?? []).map(normNum).filter((n) => /\d/.test(n));
  const quoteNums = new Set((quote.match(NUM) ?? []).map(normNum));
  const extra = claimNums.filter((n) => !quoteNums.has(n));
  if (extra.length) return { pass: false, reason: `Claim adds a number the source doesn't state (${extra.join(", ")})` };
  const content = words(claim).filter((w) => w.length > 2 && !FIDELITY_STOP.has(w) && !marks.some((m) => w.startsWith(m)));
  if (content.length >= 3) {
    const shared = content.filter((w) => qWords.has(w) || [...qWords].some((q) => q.length > 4 && (q.startsWith(w.slice(0, 5)) || w.startsWith(q.slice(0, 5))))).length;
    if (shared / content.length < 0.4) return { pass: false, reason: "Claim goes beyond what the quoted sentence says" };
  }
  if (marks.length) {
    const near = ` ${squash(`${quote} ${passage ?? ""}`)} `;
    if (!marks.some((m) => near.includes(m))) return { pass: false, reason: "The quoted sentence isn't about this company" };
  }
  return { pass: true, reason: "Claim matches its quote" };
}

/** The paragraph around the quote on the page (about `radius` characters either side). */
export function passageAround(text: string, quote: string, radius = 350): string | null {
  const flat = plainText(text);
  const probe = plainText(quote).slice(0, 40);
  let at = flat.indexOf(probe);
  if (at < 0) at = flat.toLowerCase().indexOf(probe.toLowerCase());
  if (at < 0) return null;
  return flat.slice(Math.max(0, at - radius), Math.min(flat.length, at + quote.length + radius)).trim();
}

/**
 * Fingerprint of the reported sentence. Syndicated copies of one press release share the
 * sentence word for word, so they share the fingerprint: one report, however many sites.
 */
export function reportFingerprint(quote: string | null | undefined): string | null {
  const w = quote ? words(quote) : [];
  if (w.length < 6) return null;
  let h = 2166136261;
  for (const ch of w.join(" ")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `fp${h.toString(36)}`;
}

/** Independent reports among sources: copies of the same sentence count once; each site counts once. */
export function independentReports(items: { sourceUrl?: string; fingerprint?: string | null }[]): number {
  const seen = new Set<string>();
  const hosts = new Set<string>();
  let n = 0;
  for (const i of items) {
    const host = i.sourceUrl ? hostOf(i.sourceUrl) : "";
    const key = i.fingerprint ?? `host:${host}`;
    if (seen.has(key) || (host && hosts.has(host))) continue;
    seen.add(key);
    if (host) hosts.add(host);
    n++;
  }
  return n;
}

/**
 * Direct buying intent must be explicit: the source has to say the company is evaluating,
 * selecting, tendering or budgeting for something. A guard, not a classifier — the model
 * proposes the class; without such words in a quote, code downgrades it.
 */
export function explicitIntent(quote: string | null | undefined): boolean {
  if (!quote) return false;
  return /\b(rfp|rfq|rfi|request for (proposal|quotation|information)|tender(s|ed|ing)?|bid(s|ding)?|evaluat\w+ (vendors?|solutions?|platforms?|tools?|partners?)|shortlist\w*|select(ing|ed)? (a |an )?(vendor|partner|platform|solution)|procur\w+|purchase order|budget(ed|s)? (for|to)|seeking (a |an )?(vendor|partner|solution|platform)|looking for (a |an )?(vendor|partner|solution|platform)|invit\w+ (bids|proposals)|expression of interest|implementation partner (for|to))\b/i.test(quote);
}

// ── Stage 7: fact status & contradictions ──

export interface EvidenceLike {
  id: string;
  key: string;
  value: string | null;
  sourceType: string;
  sourceUrl: string;
  publishedAt: Date;
  /** Fingerprint of the quoted sentence: copies of one release count once. */
  fingerprint?: string | null;
}

const OFFICIAL = new Set(["official", "provider"]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Official source or two independent reports → verified; one → probable; too old → stale. Copies of one release are one report. */
export function factStatus(items: EvidenceLike[], kind: FreshnessKind, now = new Date()): FieldStatus {
  if (items.length === 0) return "unknown";
  const fresh = items.filter((i) => !isStale(i.publishedAt, kind, now));
  if (fresh.length === 0) return "stale";
  if (fresh.some((i) => OFFICIAL.has(i.sourceType))) return "verified";
  return independentReports(fresh) >= 2 ? "verified" : "probable";
}

export interface Contradiction {
  key: string;
  values: string[];
  evidenceIds: string[];
}

export function findContradictions(items: EvidenceLike[]): Contradiction[] {
  const byKey = new Map<string, EvidenceLike[]>();
  for (const i of items) {
    if (i.value == null) continue;
    byKey.set(i.key, [...(byKey.get(i.key) ?? []), i]);
  }
  const out: Contradiction[] = [];
  for (const [key, list] of byKey) {
    const values = [...new Set(list.map((i) => i.value!.trim().toLowerCase()))];
    if (values.length > 1) out.push({ key, values, evidenceIds: list.map((i) => i.id) });
  }
  return out;
}

/** An official source wins. Without one the contradiction needs a person. */
export function resolveContradiction(items: EvidenceLike[]): { winnerId: string | null; reason: string } {
  const official = items.filter((i) => OFFICIAL.has(i.sourceType)).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  if (official.length === 0) return { winnerId: null, reason: "No official source — human review" };
  const values = new Set(official.map((i) => (i.value ?? "").toLowerCase()));
  if (values.size > 1) return { winnerId: null, reason: "Official sources disagree — human review" };
  return { winnerId: official[0].id, reason: `Official source wins (${official[0].sourceType})` };
}

// ── Stage 9: lawful basis ──

export function lawfulBasisFor(country: string | null): string | null {
  if (!country) return null;
  const c = country.toUpperCase();
  if ((CONFIG.euCountries as readonly string[]).includes(c)) return CONFIG.lawfulBasis.EU;
  return CONFIG.lawfulBasis[c] ?? null;
}

// ── Stage 10: readiness ──

export interface TriggerFact {
  status: FieldStatus;
  publishedAt: Date;
}

export interface NegativeFact {
  kind: string;
  publishedAt: Date;
  /** The sentence copied from the source; checked against what the blocker actually means. */
  quote?: string | null;
  /** Where it was reported: a blocker counts only when confirmed (official source, or two independent sites). */
  sourceUrl?: string;
  sourceType?: string;
  fingerprint?: string | null;
}

/**
 * Strong when one trigger is verified, or enough usable triggers come from independent reports
 * (two claims pulled from one article are one report). A validated opportunity or explicit
 * buying intent from the investigation also makes the evidence strong.
 */
export function evidenceQuality(triggers: (TriggerFact & { sourceUrl?: string; fingerprint?: string | null })[], now = new Date(), validated = 0): { strong: boolean; verified: number; usable: number; reports: number } {
  const recent = triggers.filter((t) => daysBetween(now, t.publishedAt) <= CONFIG.readiness.triggerWindowDays);
  const verified = recent.filter((t) => t.status === "verified").length;
  const usableItems = recent.filter((t) => t.status === "verified" || t.status === "probable");
  const reports = usableItems.some((t) => t.sourceUrl) ? independentReports(usableItems) : usableItems.length;
  return {
    strong: validated > 0 || verified >= CONFIG.readiness.minVerifiedTriggers || reports >= CONFIG.readiness.minUsableTriggers,
    verified,
    usable: usableItems.length,
    reports,
  };
}

/** A blocker is confirmed by one official source or by two independent sites; one article is never enough. */
export function blockerConfirmed(reports: NegativeFact[]): boolean {
  if (reports.some((r) => r.sourceType === "official")) return true;
  // Copies of one wire story on several sites are one report.
  if (reports.some((r) => r.sourceUrl)) return independentReports(reports) >= 2;
  // Facts recorded before sources were tracked count as one report each.
  return reports.length >= 2;
}

const TERMINAL = ["acquired", "bankrupt", "competitor_signed"];

const has = (re: RegExp, t: string) => re.test(t);
/** Before and after the first mention of the company in the sentence. */
function aroundCompany(quote: string, marks: string[]) {
  const t = quote.toLowerCase();
  const at = Math.min(...marks.map((m) => t.indexOf(m)).filter((i) => i >= 0));
  return Number.isFinite(at) ? { before: t.slice(0, at), after: t.slice(at) } : null;
}

/**
 * Does the sentence actually say what the blocker means? The AI often labels a company buying
 * someone else as "acquired", or a post-merger reshuffle as "layoffs"; code checks the wording.
 * Facts without a quote (sample data, older records) are taken as labelled.
 */
export function blockerSupported(kind: string, quote: string | null | undefined, companyName: string, companyDomain: string | null): boolean {
  if (!quote) return true;
  const t = quote.toLowerCase();
  const marks = companyMarks(companyName, companyDomain);
  const where = marks.length ? aroundCompany(quote, marks) : null;
  switch (kind) {
    case "acquired": {
      // THIS company is the one bought: "<Company> acquired by / sold to / merged into …" or "… acquires / acquisition of <Company>".
      const passive = /\b(acquired by|bought by|taken over by|sold to|merged into|agreed to be acquired|to be acquired)\b/;
      const active = /\b(acquires?|acquiring|to acquire|buys?|buying|to buy|acquisition of|takeover of|take over)\b/;
      if (!where) return has(passive, t);
      return has(passive, where.after) || has(active, where.before);
    }
    case "bankrupt":
      return has(/\b(insolven\w*|bankrupt\w*|liquidat\w*|winding.up|nclt|cirp|receivership)\b/, t) && !has(/\b(subsidiary|arm|unit)\b/, t);
    case "competitor_signed":
      return has(/\b(selects?|selected|chose|chosen|signs?|signed|deploys?|deployed|implements?|implemented|goes live|went live|partners? with|partnered with)\b/, t) && !has(/\b(rating|downgrade\w*|upgrade\w*|target price|price target|shares?|stock)\b/, t);
    case "layoffs":
      return has(/\b(lay.?offs?|lay(s|ing)? off|laid off|job cuts?|cuts? .{0,30}jobs|retrench\w*|redundanc\w*|reduc\w* .{0,40}(workforce|headcount|staff|employees|positions|strength))\b/, t) && !has(/\b(integrat\w*|merger|merging|acquisition|restructur\w*|realign\w*|consolidat\w*)\b/, t);
    case "hiring_freeze":
      return has(/\b(hiring freeze|freez\w* .{0,20}hiring|stop\w* hiring|paus\w* hiring)\b/, t);
    default:
      return false;
  }
}
const label = (kind: string) => kind.replace(/_/g, " ");

/**
 * Bad news never rules a company out on one article. Confirmed terminal blockers disqualify;
 * an unconfirmed one pauses the company for a person to decide ("possible blocker"). Layoffs and
 * hiring freezes park the company only when confirmed; otherwise they are context.
 */
export function negativeEvidence(negatives: NegativeFact[], now = new Date(), company?: { name: string; domain: string | null }): { outcome: "disqualified" | "possible_blocker" | "watch" | "continue"; reason: string } {
  const real = company ? negatives.filter((n) => blockerSupported(n.kind, n.quote, company.name, company.domain)) : negatives;
  const byKind = (kind: string) => real.filter((n) => n.kind === kind);
  for (const kind of TERMINAL) {
    const reports = byKind(kind);
    if (reports.length && blockerConfirmed(reports)) return { outcome: "disqualified", reason: `Negative evidence: ${label(kind)} (confirmed by ${reports.length} source${reports.length === 1 ? "" : "s"})` };
  }
  for (const kind of TERMINAL) {
    const reports = byKind(kind);
    if (reports.length) return { outcome: "possible_blocker", reason: `Possible blocker: ${label(kind)}, reported by one source only, needs a person to check` };
  }
  for (const kind of ["layoffs", "hiring_freeze"]) {
    const recent = byKind(kind).filter((n) => daysBetween(now, n.publishedAt) <= CONFIG.readiness.negativeWatchDays);
    if (recent.length && blockerConfirmed(recent)) return { outcome: "watch", reason: `${label(kind)} in the last ${CONFIG.readiness.negativeWatchDays} days (confirmed)` };
  }
  return { outcome: "continue", reason: "No confirmed blocking negative evidence" };
}

export interface ReadinessPerson {
  identity: { email: FieldStatus; title: FieldStatus; company: FieldStatus };
  buyingRole: BuyingRole;
  lawfulBasis: string | null;
  emailDeliverable: boolean;
  suppressed: boolean;
}

export interface ReadinessAccount {
  negatives: NegativeFact[];
  /** The company itself, so a blocker's wording can be checked against it. */
  company?: { name: string; domain: string | null };
  triggers: (TriggerFact & { sourceUrl?: string; fingerprint?: string | null })[];
  followupUsed: boolean;
  /** Validated supported opportunities or explicit intent from the investigation. */
  validated?: number;
  /** The latest investigation stopped with gaps: say "incomplete", never "no signal". */
  incomplete?: string | null;
}

export interface ReadinessDecision {
  outcome: ReadinessOutcome;
  reasons: string[];
  /** human_review because of an unconfirmed blocker on the company, not because of the person. */
  blocker?: boolean;
  watchDays?: number;
}

/** Rules are checked in order; the first that matches wins (mirrors the spec table). */
export function decideReadiness(acc: ReadinessAccount, p: ReadinessPerson, now = new Date()): ReadinessDecision {
  const neg = negativeEvidence(acc.negatives, now, acc.company);
  if (neg.outcome === "disqualified") return { outcome: "disqualified", reasons: [neg.reason] };
  if (neg.outcome === "possible_blocker") return { outcome: "human_review", reasons: [neg.reason], blocker: true };
  if (neg.outcome === "watch") return { outcome: "watch", reasons: [neg.reason], watchDays: CONFIG.readiness.negativeWatchDays };

  const q = evidenceQuality(acc.triggers, now, acc.validated ?? 0);
  if (!q.strong && !acc.followupUsed)
    return { outcome: "targeted_re_research", reasons: [`Evidence weak (${q.verified} verified, ${q.reports} independent report(s) of ${q.usable} usable trigger(s) in ${CONFIG.readiness.triggerWindowDays}d)`] };
  if (!q.strong)
    return { outcome: "watch", reasons: [acc.incomplete ? `Research incomplete — ${acc.incomplete}` : "Evidence still weak after the follow-up pass"], watchDays: CONFIG.readiness.weakEvidenceWatchDays };

  const ok = (s: FieldStatus) => s === "verified" || s === "probable";
  const reasons: string[] = [];
  if (!ok(p.identity.email)) reasons.push(`Email ${p.identity.email}`);
  if (!ok(p.identity.title)) reasons.push(`Title ${p.identity.title}`);
  if (!ok(p.identity.company)) reasons.push(`Company ${p.identity.company}`);
  if (!p.lawfulBasis) reasons.push("No lawful basis for region");
  if (reasons.length) return { outcome: "human_review", reasons };

  if (p.suppressed) return { outcome: "disqualified", reasons: ["Suppressed"] };
  if (!p.emailDeliverable) return { outcome: "human_review", reasons: ["Email not deliverable"] };
  if (!(CONFIG.readiness.eligibleRoles as readonly string[]).includes(p.buyingRole))
    return { outcome: "human_review", reasons: [`Role ${p.buyingRole} is not decision maker or champion`] };

  return { outcome: "ready", reasons: [`Identity ok, ${p.buyingRole.replace("_", " ")}, ${q.verified} verified / ${q.usable} usable triggers`] };
}

// ── Stage 11: guardrails ──

export interface Claim {
  text: string;
  factIds: string[];
}

export interface UsableFact {
  id: string;
  status: FieldStatus;
  publishedAt: Date;
  key: string;
}

export function factGuardrail(claims: Claim[], facts: UsableFact[], now = new Date()): GateResult {
  if (claims.length === 0) return { pass: false, reason: "Draft makes no evidence-backed claim" };
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const c of claims) {
    if (c.factIds.length === 0) return { pass: false, reason: `Claim without a cited fact: "${c.text.slice(0, 60)}"` };
    for (const id of c.factIds) {
      const f = byId.get(id);
      if (!f) return { pass: false, reason: `Claim cites unknown fact ${id}` };
      if (f.status !== "verified" && f.status !== "probable") return { pass: false, reason: `Claim cites a ${f.status} fact` };
      const kind: FreshnessKind = isTriggerKey(f.key) ? "trigger" : "company";
      if (isStale(f.publishedAt, kind, now)) return { pass: false, reason: "Claim cites a stale fact" };
    }
  }
  return { pass: true, reason: "Every claim cites a usable, fresh fact" };
}

export function complianceGate(body: string): GateResult {
  if (!/unsubscribe|opt out|opt-out/i.test(body)) return { pass: false, reason: "Missing unsubscribe line" };
  const address = seller().sender.address.trim();
  if (!address) return { pass: false, reason: "No postal address set: add it in Settings → Email sending before emails go out" };
  if (!body.includes(address)) return { pass: false, reason: "Missing sender postal address" };
  return { pass: true, reason: "Unsubscribe and sender details present" };
}

/**
 * Autonomy fence (code-enforced): when a person must approve an email before it is sent.
 * review_all → always; auto_t3 → T1/T2 always, T3 only if a critic could not run;
 * auto_all → only when a critic could not run.
 */
export function needsHumanApproval(tier: Tier | null, autonomy: "review_all" | "auto_t3" | "auto_all" = seller().autonomy): boolean {
  if (autonomy === "auto_all") return false;
  if (autonomy === "auto_t3") return tier !== "T3";
  return true;
}

/** Phrases that make a cold email read like every other cold email. */
const GENERIC_PHRASES = [
  /hope (this|you)[^.\n]{0,30}well/i, /\btouch(ing)? base\b/i, /\bjust (checking|following) (in|up)\b/i, /\bin today'?s (fast[- ]paced|competitive|digital|ever[- ]changing)/i,
  /\bi came across your (profile|company|website)\b/i, /\bsynerg/i, /\bstreamline your (operations|processes|business)\b/i, /\bunlock (the )?(full )?potential\b/i,
  /\bgame[- ]chang/i, /\bcutting[- ]edge\b/i, /\bwould love to (connect|chat|pick your brain)\b/i, /\b(take|taking) (your|the) business to the next level\b/i, /\bi wanted to reach out\b/i,
];

const STOP = new Set(["about", "their", "there", "which", "would", "could", "company", "announced", "recently", "across", "with", "from", "that", "this", "have", "will", "into", "more", "than", "they", "were", "been"]);
const distinctive = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9][a-z0-9/&.-]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);

/**
 * Specificity critic (code): the email must name the company, carry at least two
 * distinctive words from the facts it cites (a number, a programme, a place), and
 * use none of the stock cold-email phrases. Generic output is rewritten, never sent.
 */
export function specificityGate(body: string, company: string, citedFacts: string[]): GateResult {
  const generic = GENERIC_PHRASES.map((r) => body.match(r)?.[0]).find(Boolean);
  if (generic) return { pass: false, reason: `Generic phrase "${generic}" — replace it with something only true of this company` };
  const brand = company.toLowerCase().split(/\s+/)[0];
  if (brand && !body.toLowerCase().includes(brand)) return { pass: false, reason: `Does not name ${company}` };
  const words = distinctive(body);
  const factWords = new Set(citedFacts.flatMap((f) => [...distinctive(f)]).filter((w) => !w.startsWith(brand)));
  const shared = [...factWords].filter((w) => words.has(w));
  if (citedFacts.length && shared.length < 2) return { pass: false, reason: "Too generic: uses almost nothing specific from the cited facts (numbers, programme names, places)" };
  return { pass: true, reason: `Specific: ${shared.slice(0, 4).join(", ")}` };
}

/** Hard claim rules for every seller, plus the seller's own banned claims. */
/** Never tell a prospect we watched them browse. */
const VISIT_MENTION = /\b(visit(ed|ing)?|were on|been on|check(ed|ing) out|brows(ed|ing)|look(ed|ing) at|view(ed|ing)|read(ing)?|saw (that )?you)\b[^.]{0,40}\bour (website|site|pricing|blog|page|case stud)/i;
const HARD_BANNED = [VISIT_MENTION, /\bguarantee(d|s)?\b/i, /\bthe only (platform|solution|tool|company)\b/i, /\bbest[- ]in[- ]class\b/i, /#1\b|\bnumber one\b/i, /\b\d+% (off|discount)\b/i, /\brisk[- ]free\b/i];

export function bannedClaimGate(text: string, banned: string[] = seller().bannedClaims): GateResult {
  const hit = HARD_BANNED.find((r) => r.test(text));
  if (hit) return { pass: false, reason: `Banned claim: "${text.match(hit)?.[0]}"` };
  const t = text.toLowerCase();
  const own = banned.find((b) => b.length < 40 && t.includes(b.toLowerCase()));
  if (own) return { pass: false, reason: `Banned claim for this seller: "${own}"` };
  return { pass: true, reason: "No banned claims" };
}

// ── Stage 12: sending ──

export interface PreSendInput {
  suppressed: boolean;
  lawfulBasis: string | null;
  mailboxSentToday: number;
  mailboxCap: number;
  globalSentToday: number;
  contactPaused: boolean;
  breakerTripped: boolean;
}

export function preSendGate(i: PreSendInput): GateResult {
  if (i.breakerTripped) return { pass: false, reason: "Bounce breaker tripped — sending paused" };
  if (i.suppressed) return { pass: false, reason: "Recipient suppressed" };
  if (!i.lawfulBasis) return { pass: false, reason: "No lawful basis recorded" };
  if (i.contactPaused) return { pass: false, reason: "Contact paused" };
  if (i.mailboxSentToday >= i.mailboxCap) return { pass: false, reason: `Mailbox cap ${i.mailboxCap} reached` };
  if (i.globalSentToday >= CONFIG.sending.globalDailyCap) return { pass: false, reason: `Global cap ${CONFIG.sending.globalDailyCap} reached` };
  return { pass: true, reason: "Cleared to send" };
}

export function bounceBreaker(sent: number, hardBounces: number): GateResult {
  if (sent < CONFIG.sending.bounceBreakerMinSends) return { pass: true, reason: `Only ${sent} sends — breaker inactive` };
  const pct = (hardBounces / sent) * 100;
  return pct > CONFIG.sending.bounceBreakerPct
    ? { pass: false, reason: `Hard bounce rate ${pct.toFixed(1)}% > ${CONFIG.sending.bounceBreakerPct}%` }
    : { pass: true, reason: `Hard bounce rate ${pct.toFixed(1)}%` };
}

export const REPLY_ROUTES: Record<ReplyClass, string> = {
  positive: "Hand off to sales now",
  not_now: `Pause, watchlist for ${CONFIG.watch.notNowDays} days`,
  objection: "Logged to the account twin; sequence continues with objection handling",
  wrong_person: "Pause, title marked stale, referral task created, re-map buying group",
  unsubscribe: "Suppress and stop all sequences",
  out_of_office: "Delay next step until return",
  needs_human: "Review queue — a person reads it",
};
