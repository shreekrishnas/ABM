// Stages 5–7: Research Plan, Account Research, Evidence & Account Twin.

import type { Account, Evidence, FieldStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import type { ResearchPass } from "@/lib/adapters/types";
import { evidenceGate, factStatus, findContradictions, isStale, resolveContradiction, type FreshnessKind } from "../gates";
import { dataConfidence } from "../scoring";
import { BudgetExceeded, charge, logEvent, openReview, type RunContext } from "../context";
import { seller } from "@/lib/seller";

export interface PlannedQuestion {
  key: string;
  question: string;
  importance: "high" | "medium" | "low";
}

export const freshnessKindFor = (key: string): FreshnessKind => (key === "trigger" ? "trigger" : key === "negative" ? "negative" : "company");

/** Evidence that is not superseded and still fresh. */
export async function liveEvidence(accountId: string): Promise<Evidence[]> {
  return db.evidence.findMany({ where: { accountId, supersededById: null }, orderBy: { publishedAt: "desc" } });
}

const QUESTIONS_BY_TIER = { T1: 6, T2: 5, T3: 4 } as const;

// ───────────────────────── Stage 5 ─────────────────────────

export async function s05ResearchPlan(account: Account, ctx: RunContext, reason: "initial" | "refresh" | "intent_surge" = "initial"): Promise<Account> {
  const S = 5;
  const evidence = await liveEvidence(account.id);
  const knownFresh = new Set(
    evidence.filter((e) => (e.status === "verified" || e.status === "probable") && !isStale(e.publishedAt, freshnessKindFor(e.key), ctx.now)).map((e) => e.key),
  );
  const cap = Math.min(CONFIG.research.maxQuestions, QUESTIONS_BY_TIER[account.tier ?? "T3"]);
  const questions: PlannedQuestion[] = [];
  const skipped: { key: string; reason: string }[] = [];

  for (const t of seller().researchQuestions) {
    if ((CONFIG.research.neverChangesDecision as readonly string[]).includes(t.key)) {
      skipped.push({ key: t.key, reason: "Answer would not change a decision" });
    } else if (knownFresh.has(t.key) && t.key !== "negative") {
      // Negative evidence is always re-asked: its absence must be current.
      skipped.push({ key: t.key, reason: "Already known and fresh" });
    } else if (questions.length >= cap) {
      skipped.push({ key: t.key, reason: `Question cap for ${account.tier ?? "T3"} reached` });
    } else {
      questions.push({ key: t.key, question: t.question, importance: t.importance as PlannedQuestion["importance"] });
    }
  }
  await db.researchPlan.create({ data: { accountId: account.id, questions: questions as unknown as Prisma.InputJsonValue, skipped, reason } });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "research_plan.stop_rule", outcome: "pass", reason: `${questions.length} questions, ${skipped.length} skipped (${reason})`, data: { questions: questions.map((q) => q.key), skipped } });
  return account;
}

// ───────────────────────── Stage 6 ─────────────────────────

async function researchKeys(account: Account, ctx: RunContext, keys: PlannedQuestion[], pass: ResearchPass): Promise<Set<string>> {
  const S = 6;
  const answered = new Set<string>();
  for (const q of keys) {
    const pages = await ctx.adapters.research.search(account.domain ?? "", account.name, q.key, pass);
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
    const extracted = await ctx.adapters.llm.extractEvidence(pages, q.key);
    for (const e of extracted) {
      const g = evidenceGate(e, ctx.adapters.research.live ? "live" : "mock");
      if (!g.pass) {
        await logEvent(ctx, { accountId: account.id, stage: S, step: "account_research.evidence_gate", outcome: "block", reason: `Dropped "${e.claim.slice(0, 60)}": ${g.reason}` });
        continue;
      }
      // Idempotent: the same source URL for the same question is stored once.
      const dupe = await db.evidence.findFirst({ where: { accountId: account.id, key: e.key, sourceUrl: e.sourceUrl } });
      if (dupe) {
        answered.add(q.key);
        continue;
      }
      await db.evidence.create({
        data: {
          accountId: account.id, key: e.key, claim: e.claim, value: e.value, sourceUrl: e.sourceUrl, sourceType: e.sourceType,
          publishedAt: e.publishedAt, isNegative: e.isNegative, negativeKind: e.negativeKind, status: "probable", pass,
        },
      });
      answered.add(q.key);
    }
  }
  return answered;
}

export async function s06AccountResearch(account: Account, ctx: RunContext, opts: { pass?: ResearchPass; keys?: string[] } = {}): Promise<Account> {
  const S = 6;
  const pass = opts.pass ?? "main";
  const plan = await db.researchPlan.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } });
  const planned = ((plan?.questions ?? []) as unknown as PlannedQuestion[]).filter((q) => !opts.keys || opts.keys.includes(q.key));
  const keys = opts.keys && planned.length === 0 ? opts.keys.map((k) => ({ key: k, question: k, importance: "high" as const })) : planned;

  const answered = await researchKeys(account, ctx, keys, pass);
  await logEvent(ctx, { accountId: account.id, stage: S, step: pass === "main" ? "account_research.fetch_main" : "account_research.fetch_followup", outcome: "pass", reason: `${pass}: ${answered.size}/${keys.length} questions answered` });

  // One targeted follow-up for unanswered high-importance questions only.
  if (pass === "main") {
    const unanswered = keys.filter((q) => q.importance === "high" && !answered.has(q.key));
    if (unanswered.length && !account.followupUsed) {
      account = await db.account.update({ where: { id: account.id }, data: { followupUsed: true } });
      const more = await researchKeys(account, ctx, unanswered, "followup");
      await logEvent(ctx, { accountId: account.id, stage: S, step: "account_research.targeted_followup", outcome: "info", reason: `Follow-up on ${unanswered.map((q) => q.key).join(", ")}: ${more.size} answered` });
    }
  }
  return account;
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
  return account;
}
