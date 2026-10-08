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

/**
 * Truth before speed: a fact is kept only with an exact supporting quote that really
 * appears on its source page. In live mode a missing quote drops the fact.
 */
export function quoteGate(quote: string | null | undefined, page: { title: string; text: string } | undefined, adapterMode: "live" | "mock" = "mock"): GateResult {
  if (!quote || quote.trim().length < 12) return adapterMode === "live" ? { pass: false, reason: "No supporting quote from the page" } : { pass: true, reason: "Sample data (no quote required)" };
  if (!page) return { pass: false, reason: "Source page not found for the quote" };
  if (!squash(`${page.title} ${page.text}`).includes(squash(quote))) return { pass: false, reason: "Quote does not appear on the source page" };
  return { pass: true, reason: "Exact quote found on the page" };
}

// ── Stage 7: fact status & contradictions ──

export interface EvidenceLike {
  id: string;
  key: string;
  value: string | null;
  sourceType: string;
  sourceUrl: string;
  publishedAt: Date;
}

const OFFICIAL = new Set(["official", "provider"]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Official source or two independent sources → verified; one → probable; too old → stale. */
export function factStatus(items: EvidenceLike[], kind: FreshnessKind, now = new Date()): FieldStatus {
  if (items.length === 0) return "unknown";
  const fresh = items.filter((i) => !isStale(i.publishedAt, kind, now));
  if (fresh.length === 0) return "stale";
  if (fresh.some((i) => OFFICIAL.has(i.sourceType))) return "verified";
  const hosts = new Set(fresh.map((i) => hostOf(i.sourceUrl)));
  return hosts.size >= 2 ? "verified" : "probable";
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
}

export function evidenceQuality(triggers: TriggerFact[], now = new Date()): { strong: boolean; verified: number; usable: number } {
  const recent = triggers.filter((t) => daysBetween(now, t.publishedAt) <= CONFIG.readiness.triggerWindowDays);
  const verified = recent.filter((t) => t.status === "verified").length;
  const usable = recent.filter((t) => t.status === "verified" || t.status === "probable").length;
  return {
    strong: verified >= CONFIG.readiness.minVerifiedTriggers || usable >= CONFIG.readiness.minUsableTriggers,
    verified,
    usable,
  };
}

export function negativeEvidence(negatives: NegativeFact[], now = new Date()): { outcome: "disqualified" | "watch" | "continue"; reason: string } {
  const terminal = negatives.find((n) => ["acquired", "bankrupt", "competitor_signed"].includes(n.kind));
  if (terminal) return { outcome: "disqualified", reason: `Negative evidence: ${terminal.kind.replace("_", " ")}` };
  const recent = negatives.find((n) => ["layoffs", "hiring_freeze"].includes(n.kind) && daysBetween(now, n.publishedAt) <= CONFIG.readiness.negativeWatchDays);
  if (recent) return { outcome: "watch", reason: `${recent.kind.replace("_", " ")} in the last ${CONFIG.readiness.negativeWatchDays} days` };
  return { outcome: "continue", reason: "No blocking negative evidence" };
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
  triggers: TriggerFact[];
  followupUsed: boolean;
}

export interface ReadinessDecision {
  outcome: ReadinessOutcome;
  reasons: string[];
  watchDays?: number;
}

/** Rules are checked in order; the first that matches wins (mirrors the spec table). */
export function decideReadiness(acc: ReadinessAccount, p: ReadinessPerson, now = new Date()): ReadinessDecision {
  const neg = negativeEvidence(acc.negatives, now);
  if (neg.outcome === "disqualified") return { outcome: "disqualified", reasons: [neg.reason] };
  if (neg.outcome === "watch") return { outcome: "watch", reasons: [neg.reason], watchDays: CONFIG.readiness.negativeWatchDays };

  const q = evidenceQuality(acc.triggers, now);
  if (!q.strong && !acc.followupUsed)
    return { outcome: "targeted_re_research", reasons: [`Evidence weak (${q.verified} verified, ${q.usable} usable triggers in ${CONFIG.readiness.triggerWindowDays}d)`] };
  if (!q.strong) return { outcome: "watch", reasons: ["Evidence still weak after the follow-up pass"], watchDays: CONFIG.readiness.weakEvidenceWatchDays };

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
  if (!body.includes(seller().sender.address)) return { pass: false, reason: "Missing sender postal address" };
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
const HARD_BANNED = [/\bguarantee(d|s)?\b/i, /\bthe only (platform|solution|tool|company)\b/i, /\bbest[- ]in[- ]class\b/i, /#1\b|\bnumber one\b/i, /\b\d+% (off|discount)\b/i, /\brisk[- ]free\b/i];

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
