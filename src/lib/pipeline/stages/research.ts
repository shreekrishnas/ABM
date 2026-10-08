// Stages 5–7: Research Plan, Account Research, Evidence & Account Twin.

import type { Account, Evidence, FieldStatus, Prisma } from "@prisma/client";
import { isTriggerKey } from "@/lib/research/keys";
import { sellerContext } from "@/lib/seller";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import type { ResearchPage, ResearchPass } from "@/lib/adapters/types";
import { queryFor } from "@/lib/adapters/live/research";
import { evidenceGate, quoteGate, factStatus, findContradictions, isStale, resolveContradiction, type FreshnessKind } from "../gates";
import { dataConfidence } from "../scoring";
import { BudgetExceeded, charge, ensureBudget, logEvent, openReview, recordCost, type RunContext } from "../context";
import { sha256 } from "../crypto";
import { seller } from "@/lib/seller";
import { directResearch, type DirectedQuestion } from "@/lib/brain/plan";
import { buildBrief } from "@/lib/brain/strategist";
import { importContext, researchDepth } from "@/lib/research/intake";

/** A research question, as directed by the brain (query and engine are optional). */
export type PlannedQuestion = DirectedQuestion;

export const freshnessKindFor = (key: string): FreshnessKind => (isTriggerKey(key) ? "trigger" : key === "negative" ? "negative" : "company");

/** Evidence that is not superseded and still fresh. */
export async function liveEvidence(accountId: string): Promise<Evidence[]> {
  return db.evidence.findMany({ where: { accountId, supersededById: null, flagged: false }, orderBy: { publishedAt: "desc" } });
}

// ───────────────────────── Stage 5 ─────────────────────────

export async function s05ResearchPlan(account: Account, ctx: RunContext, reason: "initial" | "refresh" | "intent_surge" = "initial"): Promise<Account> {
  const S = 5;
  const evidence = await liveEvidence(account.id);
  const knownFresh = new Set(
    evidence.filter((e) => (e.status === "verified" || e.status === "probable") && !isStale(e.publishedAt, freshnessKindFor(e.key), ctx.now)).map((e) => e.key),
  );
  // What the import already told us, and how deep this company deserves to go.
  const imported = await importContext(account);
  const depth = researchDepth(account.tier, imported);
  const questions: PlannedQuestion[] = [];
  const skipped: { key: string; reason: string }[] = [];
  let deepUsed = 0;

  for (const t of seller().researchQuestions) {
    const deep = t.depth === "deep";
    if ((CONFIG.research.neverChangesDecision as readonly string[]).includes(t.key)) {
      skipped.push({ key: t.key, reason: "Answer would not change a decision" });
    } else if (t.key === "tooling" && imported.technologies.length) {
      // The CSV named the systems — don't pay to search for them again.
      skipped.push({ key: t.key, reason: `Known from import: ${imported.technologies.join(", ")}` });
    } else if (knownFresh.has(t.key) && t.key !== "negative") {
      // Negative evidence is always re-asked: its absence must be current.
      skipped.push({ key: t.key, reason: "Already known and fresh" });
    } else if (deep && deepUsed >= depth.deepKeys) {
      skipped.push({ key: t.key, reason: `Deep-dive question — ${depth.reason}` });
    } else if (questions.length >= depth.cap) {
      skipped.push({ key: t.key, reason: `Question cap reached (${depth.reason})` });
    } else {
      if (deep) deepUsed++;
      questions.push({ key: t.key, question: t.question, importance: t.importance as PlannedQuestion["importance"] });
    }
  }
  // The brain tailors each query to this company, routes it to the best engine and
  // states what it expects to find. Code keeps the caps and high-importance questions.
  const known = evidence.filter((e) => !e.isNegative).slice(0, 12).map((e) => ({ key: e.key, claim: e.claim, status: e.status }));
  const directed = await directResearch(account, questions, known, ctx, imported);
  skipped.push(...directed.skipped);
  await db.researchPlan.create({
    data: { accountId: account.id, questions: directed.questions as unknown as Prisma.InputJsonValue, skipped, reason, hypotheses: directed.hypotheses, planner: directed.planner, depth: depth.reason },
  });
  await logEvent(ctx, {
    accountId: account.id, stage: S, step: "research_plan.stop_rule", outcome: "pass",
    reason: `${directed.questions.length} questions, ${skipped.length} skipped (${reason}) — ${depth.reason} — planned by ${directed.planner}`,
    data: { questions: directed.questions.map((q) => ({ key: q.key, engine: q.engine ?? "auto" })), skipped, hypotheses: directed.hypotheses },
  });
  return account;
}

// ───────────────────────── Stage 6 ─────────────────────────

const DAY_MS = 86_400_000;

function revivePages(raw: unknown): ResearchPage[] {
  return ((raw ?? []) as (Omit<ResearchPage, "publishedAt"> & { publishedAt: string })[]).map((p) => ({ ...p, publishedAt: new Date(p.publishedAt) }));
}

/**
 * One question, searched once. A question already searched for this account within
 * the cache window is served from the stored pages, so re-runs (weekly imports,
 * retries) never pay for the same search twice. Each engine actually queried is
 * logged and charged.
 */
async function searchOnce(account: Account, ctx: RunContext, q: PlannedQuestion, pass: ResearchPass): Promise<{ pages: ResearchPage[]; queryIds: string[] }> {
  const query = q.query ?? queryFor(q.key, account.name).q;
  // Main and refresh passes answer "the question"; follow-ups are claim-specific.
  const queryHash = sha256(pass === "main" || pass === "refresh" ? `${q.key}|primary` : `${q.key}|${pass}|${query}`);
  const cached = await db.researchQuery.findFirst({
    where: { accountId: account.id, key: q.key, queryHash, cached: false, error: null, createdAt: { gte: new Date(ctx.now.getTime() - CONFIG.brain.searchCacheDays * DAY_MS) } },
    // Engines tried in one search share a timestamp; prefer the one that returned pages.
    orderBy: [{ createdAt: "desc" }, { results: "desc" }],
  });
  if (cached) {
    const row = await db.researchQuery.create({ data: { accountId: account.id, key: q.key, engine: cached.engine, query, queryHash, pass, purpose: q.why ?? null, results: cached.results, cached: true, createdAt: ctx.now } });
    await logEvent(ctx, { accountId: account.id, stage: 6, step: "brain.search_cache", outcome: "info", reason: `"${q.key}" served from a ${cached.engine} search on ${cached.createdAt.toISOString().slice(0, 10)} — no credits spent` });
    return { pages: revivePages(cached.pages), queryIds: [row.id] };
  }

  const maxCost = Math.max(0, ...ctx.adapters.research.engines().map((e) => CONFIG.costsUsd.search[e] ?? 0));
  await ensureBudget(account.id, account.tier, maxCost);
  const attempts: { engine: string; results: number; error?: string }[] = [];
  let pages: ResearchPage[] = [];
  let failure: unknown = null;
  try {
    pages = await ctx.adapters.research.search(account.domain ?? "", account.name, q.key, pass, { query: q.query, engine: q.engine, onAttempt: (a) => attempts.push(a) });
  } catch (e) {
    failure = e;
  }
  const queryIds: string[] = [];
  for (const [i, a] of attempts.entries()) {
    const cost = CONFIG.costsUsd.search[a.engine] ?? 0;
    await recordCost(account.id, "search", cost, `Search ${a.engine}: ${q.key} (${pass})`, 6);
    const last = i === attempts.length - 1;
    const row = await db.researchQuery.create({
      data: {
        accountId: account.id, key: q.key, engine: a.engine, query, queryHash, pass, purpose: q.why ?? null, results: a.results, error: a.error ?? null,
        costMicros: Math.round(cost * 1e6), pages: last && pages.length ? (pages as unknown as Prisma.InputJsonValue) : undefined, createdAt: ctx.now,
      },
    });
    queryIds.push(row.id);
  }
  if (attempts.length > 1) {
    await logEvent(ctx, { accountId: account.id, stage: 6, step: "brain.engine_fallback", outcome: "info", reason: `"${q.key}": ${attempts.map((a) => `${a.engine} ${a.error ? "failed" : `${a.results} result(s)`}`).join(" → ")}` });
  }
  if (failure) throw failure;
  return { pages, queryIds };
}

/** One gap-fill search (stage 2b), cached and charged like any other research question. */
export async function gapSearch(account: Account, ctx: RunContext, key: string, query: string, why: string): Promise<ResearchPage[]> {
  return (await searchOnce(account, ctx, { key, question: why, importance: "high", query, why }, "main")).pages;
}

async function researchKeys(account: Account, ctx: RunContext, keys: PlannedQuestion[], pass: ResearchPass): Promise<Set<string>> {
  const S = 6;
  const answered = new Set<string>();
  const strict = ctx.adapters.research.live ? "live" : "mock";
  for (const q of keys) {
    const { pages, queryIds } = await searchOnce(account, ctx, q, pass);
    if (pages.length === 0) {
      if (q.key === "negative") {
        answered.add(q.key);
        await logEvent(ctx, { accountId: account.id, stage: S, step: "account_research.fetch_main", outcome: "info", reason: "No negative news found — counts as an answer" });
      } else {
        await logEvent(ctx, { accountId: account.id, stage: S, step: pass === "main" ? "account_research.fetch_main" : "account_research.fetch_followup", outcome: "info", reason: `No sources for "${q.key}" (${pass})` });
      }
      continue;
    }
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, `Extract evidence: ${q.key}`, S);
    // Facts we already hold, so the brain can tell "a second source for the same event"
    // from "a new event" — that is what turns a probable fact into a verified one.
    const held = (await liveEvidence(account.id)).filter((e) => e.key === q.key && !e.isNegative).slice(0, 8);
    const extracted = await ctx.adapters.llm.extractEvidence(pages, q.key, held.map((e) => ({ id: e.id, claim: e.claim })));
    let kept = 0;
    for (const e of extracted) {
      const page = pages.find((p) => p.url === e.sourceUrl);
      const gq = quoteGate(e.quote, page, strict);
      const g = !gq.pass ? gq : evidenceGate(e, strict);
      if (!g.pass) {
        await logEvent(ctx, { accountId: account.id, stage: S, step: "account_research.evidence_gate", outcome: "block", reason: `Dropped "${e.claim.slice(0, 60)}": ${g.reason}` });
        continue;
      }
      // Idempotent: the same source URL for the same question is stored once.
      const dupe = await db.evidence.findFirst({ where: { accountId: account.id, key: e.key, sourceUrl: e.sourceUrl } });
      if (dupe) {
        if (!dupe.flagged) answered.add(q.key);
        continue;
      }
      const same = e.sameAsFactId ? held.find((h) => h.id === e.sameAsFactId) : undefined;
      const engine = pages.find((p) => p.url === e.sourceUrl)?.engine ?? null;
      await db.evidence.create({
        data: {
          sellerId: sellerContext().pack.id, sellerPackVersion: sellerContext().version,
          accountId: account.id, key: e.key,
          // A confirmation of a fact we hold takes that fact's wording and value, so the
          // two sources group together and corroborate.
          claim: same ? same.claim : e.claim, value: same ? same.value : e.value,
          sourceUrl: e.sourceUrl, sourceType: e.sourceType, publishedAt: e.publishedAt, isNegative: e.isNegative, negativeKind: e.negativeKind,
          status: "probable", pass, engine, quote: e.quote?.slice(0, 400) ?? null,
        },
      });
      if (same) await logEvent(ctx, { accountId: account.id, stage: S, step: "brain.corroborate", outcome: "pass", reason: `Second source for "${same.claim.slice(0, 80)}": ${e.sourceUrl}` });
      kept++;
      answered.add(q.key);
    }
    if (queryIds.length) await db.researchQuery.update({ where: { id: queryIds[queryIds.length - 1] }, data: { kept } });
  }
  return answered;
}

export async function s06AccountResearch(account: Account, ctx: RunContext, opts: { pass?: ResearchPass; keys?: string[] } = {}): Promise<Account> {
  const S = 6;
  const pass = opts.pass ?? "main";
  const plan = await db.researchPlan.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } });
  const planned = ((plan?.questions ?? []) as unknown as PlannedQuestion[]).filter((q) => !opts.keys || opts.keys.includes(q.key));
  let keys: PlannedQuestion[] = opts.keys && planned.length === 0 ? opts.keys.map((k) => ({ key: k, question: k, importance: "high" as const })) : planned;
  if (pass === "followup" && opts.keys?.includes("trigger")) keys = await corroborationQuestions(account, keys, ctx);

  const answered = await researchKeys(account, ctx, keys, pass);
  await logEvent(ctx, { accountId: account.id, stage: S, step: pass === "main" ? "account_research.fetch_main" : "account_research.fetch_followup", outcome: "pass", reason: `${pass}: ${answered.size}/${keys.length} questions answered` });

  // One targeted follow-up for unanswered high-importance questions only.
  if (pass === "main") {
    // Broaden the wording: every engine already came back empty for the precise query.
    const unanswered = keys.filter((q) => q.importance === "high" && !answered.has(q.key)).map((q) => ({ ...q, query: `${account.name} ${q.key.replace(/_/g, " ")} ${q.key === "trigger" ? "news 2026" : ""}`.trim(), why: `Broadened follow-up: ${q.why ?? q.question}` }));
    if (unanswered.length && !account.followupUsed) {
      account = await db.account.update({ where: { id: account.id }, data: { followupUsed: true } });
      const more = await researchKeys(account, ctx, unanswered, "followup");
      await logEvent(ctx, { accountId: account.id, stage: S, step: "account_research.targeted_followup", outcome: "info", reason: `Follow-up on ${unanswered.map((q) => q.key).join(", ")}: ${more.size} answered` });
    }
  }
  return account;
}

/**
 * Follow-up on weak trigger evidence: instead of repeating the generic search on
 * another engine, look for a second, independent source for the best single-source
 * trigger, on a different engine than the one that found it.
 */
async function corroborationQuestions(account: Account, keys: PlannedQuestion[], ctx: RunContext): Promise<PlannedQuestion[]> {
  const probable = (await liveEvidence(account.id)).filter((e) => isTriggerKey(e.key) && e.status === "probable" && !e.isNegative);
  if (!probable.length) return keys;
  const best = probable[0];
  const engines = ctx.adapters.research.engines();
  const other = engines.find((e) => e !== best.engine) ?? engines[0];
  const about = best.claim.replace(new RegExp(`^${account.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "").slice(0, 160);
  await logEvent(ctx, { accountId: account.id, stage: 6, step: "brain.corroborate", outcome: "info", reason: `Looking for a second source on ${other ?? "auto"} for: ${best.claim.slice(0, 100)}` });
  return keys.map((k) => (k.key === "trigger" ? { ...k, query: `"${account.name}" ${about}`, engine: other, why: `Corroborate: ${best.claim.slice(0, 120)}` } : k));
}

// ───────────────────────── Stage 7 ─────────────────────────

// Keys whose evidence describes one value; differing values are a contradiction.
const SINGLE_VALUE_KEYS = ["partner_network", "owner_function"];

export interface TwinSnapshot {
  facts: { id: string; key: string; claim: string; status: FieldStatus; sourceUrl: string; sourceType: string; publishedAt: string }[];
  inferences: { text: string; basedOn: string[] }[];
  contradictions: { key: string; values: string[]; resolution: string }[];
  negatives: { id: string; kind: string | null; claim: string; publishedAt: string }[];
  changed: string[];
  unknowns: string[];
  noNegativeNews: boolean;
}

export async function s07AccountTwin(account: Account, ctx: RunContext, opts: { allowReopen?: boolean } = {}): Promise<Account> {
  const S = 7;
  const allowReopen = opts.allowReopen ?? true;
  let evidence = await liveEvidence(account.id);

  // Contradictions: official source wins; otherwise reopen once, then a person.
  const contradictions: TwinSnapshot["contradictions"] = [];
  const singles = evidence.filter((e) => SINGLE_VALUE_KEYS.includes(e.key));
  for (const c of findContradictions(singles)) {
    const items = singles.filter((e) => c.evidenceIds.includes(e.id));
    const res = resolveContradiction(items);
    if (res.winnerId) {
      await db.evidence.updateMany({ where: { id: { in: c.evidenceIds.filter((id) => id !== res.winnerId) } }, data: { supersededById: res.winnerId } });
      contradictions.push({ key: c.key, values: c.values, resolution: res.reason });
      await logEvent(ctx, { accountId: account.id, stage: S, step: "account_twin.resolve_contradiction", outcome: "pass", reason: `${c.key}: ${res.reason}` });
    } else if (allowReopen && !account.reopenUsed) {
      account = await db.account.update({ where: { id: account.id }, data: { reopenUsed: true } });
      await logEvent(ctx, { accountId: account.id, stage: S, step: "account_twin.contradiction", outcome: "info", reason: `${c.key} values disagree (${c.values.join(" vs ")}) — reopening once` });
      await s06AccountResearch(account, ctx, { pass: "reopen", keys: [c.key] });
      return s07AccountTwin(account, ctx, { allowReopen: false });
    } else {
      await db.evidence.updateMany({ where: { id: { in: c.evidenceIds } }, data: { status: "conflicting" } });
      contradictions.push({ key: c.key, values: c.values, resolution: "Unresolved — human review" });
      await openReview({ type: "contradiction", stage: S, accountId: account.id, reason: `${c.key}: sources disagree (${c.values.join(" vs ")}) and no official source`, payload: { evidenceIds: c.evidenceIds } });
      await logEvent(ctx, { accountId: account.id, stage: S, step: "account_twin.contradiction", outcome: "block", reason: `${c.key} still unresolved after reopen — human review` });
    }
  }
  evidence = await liveEvidence(account.id);

  // Statuses: per (key, value) group so independent sources for the same fact corroborate.
  const groups = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (e.status === "conflicting") continue;
    const g = `${e.key}|${(e.value ?? e.claim).toLowerCase()}`;
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  for (const items of groups.values()) {
    const kind = freshnessKindFor(items[0].key);
    // Each trigger claim is its own fact; corroboration needs another source on the same claim.
    const status = factStatus(items, kind, ctx.now);
    await db.evidence.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { status } });
  }
  evidence = await liveEvidence(account.id);

  const usableFacts = evidence.filter((e) => (e.status === "verified" || e.status === "probable") && !e.isNegative);
  let inferences: TwinSnapshot["inferences"] = [];
  if (usableFacts.length) {
    try {
      await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, "Infer from facts", S);
      const ids = new Set(usableFacts.map((f) => f.id));
      const raw = await ctx.adapters.llm.infer(usableFacts.map((f) => ({ id: f.id, key: f.key, claim: f.claim })));
      inferences = raw.filter((i) => i.basedOn.length > 0 && i.basedOn.every((id) => ids.has(id)));
      const rejected = raw.length - inferences.length;
      if (rejected) await logEvent(ctx, { accountId: account.id, stage: S, step: "account_twin.infer", outcome: "block", reason: `${rejected} inference(s) rejected — no valid basis` });
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      await logEvent(ctx, { accountId: account.id, stage: S, step: "account_twin.infer", outcome: "info", reason: "Skipped inference — budget reached" });
    }
  }

  const plan = await db.researchPlan.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } });
  const planned = ((plan?.questions ?? []) as unknown as PlannedQuestion[]).map((q) => q.key);
  const usableKeys = new Set(evidence.filter((e) => e.status === "verified" || e.status === "probable").map((e) => e.key));
  const noNegativeNews = planned.includes("negative") && !evidence.some((e) => e.isNegative);
  const unknowns = planned.filter((k) => !usableKeys.has(k) && !(k === "negative" && noNegativeNews));

  const prev = await db.twinVersion.findFirst({ where: { accountId: account.id }, orderBy: { version: "desc" } });
  const prevSnap = prev?.snapshot as unknown as TwinSnapshot | undefined;
  const prevFacts = new Map((prevSnap?.facts ?? []).map((f) => [f.id, f.status]));
  const facts: TwinSnapshot["facts"] = evidence
    .filter((e) => !e.isNegative)
    .map((e) => ({ id: e.id, key: e.key, claim: e.claim, status: e.status, sourceUrl: e.sourceUrl, sourceType: e.sourceType, publishedAt: e.publishedAt.toISOString() }));
  const changed: string[] = [];
  for (const f of facts) {
    if (!prevFacts.has(f.id)) changed.push(`New ${f.key}: ${f.claim}`);
    else if (prevFacts.get(f.id) !== f.status) changed.push(`${f.key} now ${f.status}: ${f.claim}`);
  }
  const negatives = evidence.filter((e) => e.isNegative).map((e) => ({ id: e.id, kind: e.negativeKind, claim: e.claim, publishedAt: e.publishedAt.toISOString() }));
  const snapshot: TwinSnapshot = { facts, inferences, contradictions, negatives, changed, unknowns, noNegativeNews };

  await db.twinVersion.create({ data: { accountId: account.id, version: (prev?.version ?? 0) + 1, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
  const fieldStatuses = (await db.fieldState.findMany({ where: { accountId: account.id } })).map((f) => f.status);
  const conf = dataConfidence([...fieldStatuses, ...evidence.map((e) => e.status)], 1);
  account = await db.account.update({ where: { id: account.id }, data: { dataConfidence: conf } });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "account_twin.save_twin", outcome: "pass", reason: `v${(prev?.version ?? 0) + 1}: ${facts.length} facts, ${inferences.length} inferences, ${unknowns.length} unknowns, ${changed.length} changes` });
  // The brain connects the facts to the seller's use cases and plans an angle per role.
  await buildBrief(account, snapshot, ctx);
  return (await db.account.findUnique({ where: { id: account.id } })) ?? account;
}
