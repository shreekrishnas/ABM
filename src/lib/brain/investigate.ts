// The research engine's core loop. After the baseline questions, the AI investigates like an
// analyst: observe → hypothesise → ask the question whose answer would most change the
// conclusion (including ones that could disprove it) → search → connect → re-plan, within
// round and cost ceilings. Then the evidence is connected into typed links and classified,
// checked for completeness, and handed to an independent validator that can send weak links
// back for repair. Every round is saved, so a run cut off mid-way resumes where it stopped.

import type { Account, Evidence, Hypothesis, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { seller, sellerContext } from "@/lib/seller";
import { BudgetExceeded, charge, logEvent, type RunContext } from "@/lib/pipeline/context";
import { claimFidelity, companyMarks, entityGate, explicitIntent, independentReports, isStale, quoteGate } from "@/lib/pipeline/gates";
import { isTriggerKey } from "@/lib/research/keys";
import { relevanceMap } from "./relevance";
import { assessCompleteness, type Completeness } from "./completeness";
import { CLASS_RANK, CLASSIFICATIONS, type Classification, type ConnectOutput, type InvestigationFact, type InvestigationHypothesis, type Purpose } from "./research-types";

export const INVESTIGATION_KEY = "investigation";

export interface TraceQuestion {
  question: string;
  query: string;
  purpose: Purpose;
  why: string;
  value: number;
  hypothesis: string | null;
  found: number;
  kept: number;
}
export interface TraceRound {
  round: number;
  at: string;
  questions: TraceQuestion[];
  note?: string;
}

/** A question the engine asks the web; supplied by the research stage so this module stays free of search details. */
export type Asker = (account: Account, ctx: RunContext, q: { key: string; question: string; query: string; why: string; breadth: "first" | "all"; pass: "investigate" | "repair" }) => Promise<{ found: number; kept: string[] }>;

const limitsFor = (tier: Account["tier"]) => CONFIG.investigation.byTier[tier ?? "T3"];

const toFact = (e: Evidence): InvestigationFact => ({
  id: e.id, key: e.key, claim: e.claim, quote: e.quote, publisher: e.publisher, publishedAt: e.publishedAt.toISOString().slice(0, 10), status: e.status, negative: e.isNegative,
});
const toHyp = (h: Hypothesis): InvestigationHypothesis => ({
  id: h.id, text: h.text, classification: h.classification, status: h.status, useCase: h.useCase, supportIds: h.supportIds, counterIds: h.counterIds, assumptions: h.assumptions,
});

async function factsFor(accountId: string) {
  return db.evidence.findMany({ where: { accountId, supersededById: null, flagged: false, status: { in: ["verified", "probable", "stale"] } }, orderBy: { publishedAt: "desc" }, take: 60 });
}

async function liveHypotheses(accountId: string) {
  return db.hypothesis.findMany({ where: { accountId, status: { not: "rejected" } }, orderBy: { createdAt: "asc" } });
}

const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Run (or resume) an investigation for one company. Returns the finished run. */
export async function investigateAccount(account: Account, ctx: RunContext, ask: Asker) {
  const S = 7;
  const lim = limitsFor(account.tier);
  const sc = sellerContext();
  const relevance = relevanceMap(seller(), sc.version);
  // Resume a run cut off by the host's time limit (same day), otherwise start a new one.
  const open = await db.researchRun.findFirst({ where: { accountId: account.id, status: "in_progress", createdAt: { gte: new Date(ctx.now.getTime() - 86_400_000) } }, orderBy: { createdAt: "desc" } });
  let run = open ?? (await db.researchRun.create({ data: { accountId: account.id, sellerId: sc.pack.id } }));
  const trace: TraceRound[] = (run.trace as unknown as TraceRound[]) ?? [];
  const asked = new Set(trace.flatMap((r) => r.questions.map((q) => norm(q.query))));
  const first = account.name.toLowerCase().split(/\s+/)[0];
  const company = { name: account.name, domain: account.domain, industry: account.industry, employees: account.employees, country: account.country };
  let stopReason = "";
  let capped = false;
  let budgetHit = false;
  let dry = 0;
  const proposed: { question: string; value: number; asked: boolean }[] = [];

  if (open) await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.resume", outcome: "info", reason: `Resuming the investigation at round ${run.rounds + 1}` });

  for (let round = run.rounds + 1; ; round++) {
    if (round > lim.rounds) {
      capped = true;
      stopReason = `Round limit reached (${lim.rounds} for ${account.tier ?? "T3"})`;
      break;
    }
    const facts = await factsFor(account.id);
    const hyps = await liveHypotheses(account.id);
    let plan;
    try {
      await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmBrain, `Investigate round ${round}`, S);
      plan = await ctx.adapters.llm.investigate({ company, relevance, facts: facts.map(toFact), hypotheses: hyps.map(toHyp), asked: [...asked], round, maxQuestions: lim.questionsPerRound });
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        budgetHit = true;
        stopReason = "Budget ceiling reached";
      } else {
        stopReason = `Investigator unavailable: ${e instanceof Error ? e.message.slice(0, 160) : e}`;
        await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.plan", outcome: "error", reason: stopReason });
      }
      break;
    }

    // Hypotheses: create new ones, update existing ones; only facts we hold may support them.
    const factIds = new Set(facts.map((f) => f.id));
    const refMap = new Map<string, string>();
    for (const h of plan.hypotheses) {
      const support = h.supportIds.filter((id) => factIds.has(id));
      const counter = h.counterIds.filter((id) => factIds.has(id));
      const existing = hyps.find((x) => x.id === h.ref);
      if (existing) {
        await db.hypothesis.update({ where: { id: existing.id }, data: { text: h.text, useCase: h.useCase ?? existing.useCase, assumptions: h.assumptions, supportIds: [...new Set([...existing.supportIds, ...support])], counterIds: [...new Set([...existing.counterIds, ...counter])] } });
        refMap.set(h.ref, existing.id);
      } else if (hyps.length + refMap.size < 8) {
        const created = await db.hypothesis.create({ data: { accountId: account.id, researchRunId: run.id, text: h.text, useCase: h.useCase ?? null, assumptions: h.assumptions, supportIds: support, counterIds: counter } });
        refMap.set(h.ref, created.id);
      }
    }

    // Next questions by expected value of information; new queries only, naming the company.
    for (const q of plan.questions) proposed.push({ question: q.question, value: q.value, asked: false });
    const next = plan.questions
      .filter((q) => !asked.has(norm(q.query)))
      .sort((a, b) => b.value - a.value || (a.purpose === "disconfirm" ? -1 : 1))
      .slice(0, lim.questionsPerRound);
    if (!next.length) {
      stopReason = plan.done ? `Investigator: ${plan.doneWhy || "enough has been learned"}` : "No new questions worth asking";
      break;
    }

    const roundTrace: TraceRound = { round, at: ctx.now.toISOString(), questions: [] };
    let keptThisRound = 0;
    for (const q of next) {
      const query = q.query.toLowerCase().includes(first) ? q.query : `"${account.name}" ${q.query}`;
      asked.add(norm(q.query));
      const p = proposed.find((x) => x.question === q.question);
      if (p) p.asked = true;
      let res = { found: 0, kept: [] as string[] };
      try {
        res = await ask(account, ctx, { key: INVESTIGATION_KEY, question: q.question, query: query.slice(0, 240), why: q.why, breadth: q.purpose === "disconfirm" || q.value >= 5 ? "all" : "first", pass: "investigate" });
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          budgetHit = true;
          stopReason = "Budget ceiling reached";
        } else {
          roundTrace.note = `Search failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`;
        }
      }
      keptThisRound += res.kept.length;
      const hypRef = q.hypothesisRef ? refMap.get(q.hypothesisRef) ?? q.hypothesisRef : null;
      // Facts found by a confirming/disconfirming question attach to its hypothesis.
      if (hypRef && res.kept.length) {
        const h = await db.hypothesis.findUnique({ where: { id: hypRef } });
        if (h) await db.hypothesis.update({ where: { id: h.id }, data: q.purpose === "disconfirm" ? { counterIds: [...new Set([...h.counterIds, ...res.kept])] } : { supportIds: [...new Set([...h.supportIds, ...res.kept])] } });
      }
      roundTrace.questions.push({ question: q.question, query, purpose: q.purpose, why: q.why, value: q.value, hypothesis: hypRef, found: res.found, kept: res.kept.length });
      if (budgetHit) break;
    }
    trace.push(roundTrace);
    run = await db.researchRun.update({ where: { id: run.id }, data: { rounds: round, trace: trace as unknown as Prisma.InputJsonValue } });
    await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.round", outcome: "info", reason: `Round ${round}: ${roundTrace.questions.map((q) => `${q.purpose} "${q.question.slice(0, 70)}" → ${q.kept} kept`).join("; ")}` });
    if (budgetHit) break;
    // Progress test: two rounds in a row with nothing new means more of the same won't help — unless the
    // questions are high-value (a hidden programme often takes several follow-ups); the round cap bounds cost.
    dry = keptThisRound ? 0 : dry + 1;
    if (dry >= 2 && next.every((q) => q.value < 4)) {
      stopReason = "No new evidence in two rounds";
      break;
    }
    if (plan.done) {
      stopReason = `Investigator: ${plan.doneWhy || "enough has been learned"}`;
      break;
    }
  }

  // Connect, check, validate (with one repair round when the validator asks for it).
  await connect(account, ctx, relevance);
  let completeness = await completenessFor(account, run.id, trace, proposed, capped, budgetHit, ctx.now);
  let validation = await validate(account, ctx);
  if (validation.repair.length && !budgetHit) {
    const repairRound: TraceRound = { round: trace.length + 1, at: ctx.now.toISOString(), questions: [], note: "Repair: questions returned by the validator" };
    for (const q of validation.repair.slice(0, CONFIG.investigation.maxRepairQuestions)) {
      if (asked.has(norm(q.query))) continue;
      asked.add(norm(q.query));
      const query = q.query.toLowerCase().includes(first) ? q.query : `"${account.name}" ${q.query}`;
      try {
        const res = await ask(account, ctx, { key: INVESTIGATION_KEY, question: q.question, query: query.slice(0, 240), why: `Validator: ${q.question}`, breadth: "all", pass: "repair" });
        if (res.kept.length) {
          const h = await db.hypothesis.findUnique({ where: { id: q.hypothesisId } });
          if (h) await db.hypothesis.update({ where: { id: h.id }, data: { supportIds: [...new Set([...h.supportIds, ...res.kept])] } });
        }
        repairRound.questions.push({ question: q.question, query, purpose: "confirm", why: "Returned by the validator", value: 5, hypothesis: q.hypothesisId, found: res.found, kept: res.kept.length });
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          budgetHit = true;
          break;
        }
        repairRound.note += ` · search failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`;
      }
    }
    if (repairRound.questions.length) {
      trace.push(repairRound);
      await connect(account, ctx, relevance);
      validation = await validate(account, ctx, validation.rounds);
      completeness = await completenessFor(account, run.id, trace, proposed, capped, budgetHit, ctx.now);
    }
  }

  const status = completeness.complete ? "complete" : "incomplete";
  const reason = stopReason || (completeness.complete ? "Investigation complete" : "Stopped with open gaps");
  run = await db.researchRun.update({
    where: { id: run.id },
    data: { status, stopReason: reason, trace: trace as unknown as Prisma.InputJsonValue, completeness: completeness as unknown as Prisma.InputJsonValue, validation: validation.record as unknown as Prisma.InputJsonValue, finishedAt: ctx.now, rounds: trace.length },
  });
  await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.done", outcome: status === "complete" ? "pass" : "info", reason: `${status === "complete" ? "Complete" : "Research incomplete"} after ${trace.length} round(s): ${reason}${completeness.gaps.length ? ` — gaps: ${completeness.gaps.slice(0, 3).join("; ")}` : ""}` });
  return run;
}

// ── Connect: typed links and honest classes, with code guards ──

/** The strongest class the evidence allows (code), whatever the model proposed. */
export function guardClass(proposed: Classification, support: Pick<Evidence, "quote" | "sourceUrl" | "fingerprint" | "status">[]): { classification: Classification; why: string | null } {
  let c = proposed;
  const usable = support.filter((s) => s.status === "verified" || s.status === "probable");
  if (c === "direct_intent" && !usable.some((s) => explicitIntent(s.quote))) {
    c = "supported_opportunity";
  }
  if (c === "supported_opportunity" && (usable.length < 2 || independentReports(usable) < 2)) c = "relevant_development";
  if ((c === "relevant_development" || c === "verified_event") && usable.length < 1) c = "inconclusive";
  return { classification: c, why: c === proposed ? null : `Code downgraded ${proposed} → ${c}: ${c === "supported_opportunity" ? "no source states an evaluation, tender or purchase" : c === "relevant_development" ? "needs two independent reports" : "no usable supporting fact"}` };
}

async function connect(account: Account, ctx: RunContext, relevance: ReturnType<typeof relevanceMap>) {
  const S = 7;
  const hyps = await liveHypotheses(account.id);
  if (!hyps.length) return;
  const facts = await factsFor(account.id);
  const byId = new Map(facts.map((f) => [f.id, f]));
  let out: ConnectOutput;
  try {
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmBrain, "Connect evidence", S);
    out = await ctx.adapters.llm.connectEvidence({ company: { name: account.name, domain: account.domain }, relevance, facts: facts.map(toFact), hypotheses: hyps.map(toHyp) });
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.connect", outcome: "error", reason: `Connector failed: ${e instanceof Error ? e.message.slice(0, 160) : e}` });
    return;
  }
  const useCases = new Set(relevance.useCases.map((u) => u.key));
  await db.evidenceLink.deleteMany({ where: { accountId: account.id, hypothesisId: { in: hyps.map((h) => h.id) } } });
  for (const r of out.hypotheses) {
    const h = hyps.find((x) => x.id === r.id);
    if (!h) continue;
    const supportIds = [...new Set([...h.supportIds, ...r.supportIds])].filter((id) => byId.has(id));
    const counterIds = [...new Set([...h.counterIds, ...r.counterIds])].filter((id) => byId.has(id));
    const g = guardClass(r.classification, supportIds.map((id) => byId.get(id)!));
    await db.hypothesis.update({
      where: { id: h.id },
      data: { classification: g.classification, rationale: [r.rationale, g.why].filter(Boolean).join(" · ").slice(0, 900), useCase: r.useCase && useCases.has(r.useCase) ? r.useCase : h.useCase, supportIds, counterIds, alternatives: r.alternatives, status: g.classification === "irrelevant" ? "refuted" : supportIds.length ? "supported" : "open" },
    });
  }
  const validRef = (ref: string) => {
    const [kind, id] = [ref.split(":")[0], ref.slice(ref.indexOf(":") + 1)];
    if (kind === "fact") return byId.has(id);
    if (kind === "capability") return useCases.has(id);
    if (kind === "hypothesis") return hyps.some((h) => h.id === id);
    return kind === "entity" && id.length > 1;
  };
  let kept = 0;
  for (const l of out.links) {
    if (!validRef(l.from) || !validRef(l.to)) continue;
    const evidenceIds = l.evidenceIds.filter((id) => byId.has(id));
    const hypothesisId = l.hypothesisId && hyps.some((h) => h.id === l.hypothesisId) ? l.hypothesisId : null;
    // A link with no evidence is an assumption, shown as one.
    await db.evidenceLink.create({ data: { accountId: account.id, hypothesisId, fromRef: l.from, relation: l.relation, toRef: l.to, rationale: l.rationale, evidenceIds, isHypothesis: evidenceIds.length === 0 } });
    kept++;
  }
  await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.connect", outcome: "pass", reason: `${out.hypotheses.length} hypothesis/es classified, ${kept} link(s) stored` });
}

// ── Completeness ──

async function completenessFor(account: Account, runId: string, trace: TraceRound[], proposed: { question: string; value: number; asked: boolean }[], capped: boolean, budgetHit: boolean, now: Date): Promise<Completeness> {
  const [hyps, facts, queries, plan] = await Promise.all([
    liveHypotheses(account.id),
    factsFor(account.id),
    db.researchQuery.findMany({ where: { accountId: account.id }, select: { key: true, error: true } }),
    db.researchPlan.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const high = ((plan?.questions ?? []) as { key: string; importance: string }[]).filter((q) => q.importance === "high").map((q) => q.key);
  return assessCompleteness({
    requiredKeys: high,
    searchedKeys: [...new Set(queries.filter((q) => !q.error).map((q) => q.key))],
    answeredKeys: [...new Set(facts.filter((f) => f.status !== "stale").map((f) => f.key))],
    hypotheses: hyps.map((h) => ({ id: h.id, classification: h.classification as Classification, supportIds: h.supportIds, counterIds: h.counterIds })),
    disconfirmAsked: trace.flatMap((r) => r.questions.filter((q) => q.purpose === "disconfirm" && q.hypothesis).map((q) => q.hypothesis!)),
    facts: Object.fromEntries(facts.map((f) => [f.id, { sourceUrl: f.sourceUrl, fingerprint: f.fingerprint, stale: isStale(f.publishedAt, isTriggerKey(f.key) ? "trigger" : "company", now), status: f.status }])),
    unasked: proposed.filter((p) => !p.asked && p.value >= 4).map((p) => p.question),
    capped,
    budgetHit,
  });
}

// ── Independent validation ──

interface Repair { hypothesisId: string; question: string; query: string }

async function validate(account: Account, ctx: RunContext, previousRounds = 0): Promise<{ repair: Repair[]; rounds: number; record: unknown }> {
  const S = 7;
  const hyps = (await liveHypotheses(account.id)).filter((h) => CLASS_RANK[h.classification as Classification] >= CLASS_RANK.verified_event);
  if (!hyps.length) return { repair: [], rounds: previousRounds, record: { model: null, results: [], rounds: previousRounds } };
  const facts = await factsFor(account.id);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const links = await db.evidenceLink.findMany({ where: { accountId: account.id, hypothesisId: { in: hyps.map((h) => h.id) } } });
  const marks = companyMarks(account.name, account.domain);

  // 1. Code: reopen each supporting passage — the quote must be in it, about this company, and say what the claim says.
  const codeIssues = new Map<string, string[]>();
  for (const h of hyps) {
    const issues: string[] = [];
    for (const id of h.supportIds) {
      const f = byId.get(id);
      if (!f) continue;
      if (f.quote && f.passage) {
        if (!quoteGate(f.quote, { title: "", text: f.passage }, "live").pass) issues.push(`Fact ${id}: quote not found in its stored passage`);
        else if (!entityGate(account.name, account.domain, { url: f.sourceUrl, title: "", text: f.passage }).pass) issues.push(`Fact ${id}: passage doesn't name ${account.name}`);
        else if (!claimFidelity(f.claim, f.quote, marks, f.passage).pass) issues.push(`Fact ${id}: claim goes beyond its quote`);
      }
      if (isStale(f.publishedAt, isTriggerKey(f.key) ? "trigger" : "company", ctx.now)) issues.push(`Fact ${id}: stale (${f.publishedAt.toISOString().slice(0, 10)})`);
    }
    if (issues.length) codeIssues.set(h.id, issues);
  }

  // 2. Model: a separate reviewer with raw evidence challenges each hypothesis.
  let results: { hypothesisId: string; verdict: string; classification: Classification; issues: string[]; alternatives: string[]; repairQuestions: { question: string; query: string }[] }[] = [];
  let model: string | null = null;
  try {
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmBrain, "Validate research", S);
    const out = await ctx.adapters.validator.validateResearch({
      company: { name: account.name, domain: account.domain },
      today: ctx.now.toISOString().slice(0, 10),
      hypotheses: hyps.map((h) => ({
        id: h.id, text: h.text, classification: h.classification, rationale: h.rationale,
        support: h.supportIds.map((id) => byId.get(id)).filter(Boolean).map((f) => ({ id: f!.id, claim: f!.claim, quote: f!.quote, passage: f!.passage, publisher: f!.publisher, publishedAt: f!.publishedAt.toISOString().slice(0, 10), fingerprint: f!.fingerprint })),
        counter: h.counterIds.map((id) => byId.get(id)).filter(Boolean).map((f) => ({ id: f!.id, claim: f!.claim, quote: f!.quote })),
        links: links.filter((l) => l.hypothesisId === h.id).map((l) => ({ from: l.fromRef, relation: l.relation, to: l.toRef, rationale: l.rationale, evidenceIds: l.evidenceIds })),
      })),
    });
    model = ctx.adapters.validator.model;
    results = out.results.filter((r) => hyps.some((h) => h.id === r.hypothesisId));
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.validate", outcome: "error", reason: `Validator unavailable — conclusions stay unvalidated: ${e instanceof Error ? e.message.slice(0, 160) : e}` });
  }

  const repair: Repair[] = [];
  const canRepair = previousRounds < CONFIG.investigation.maxValidationRounds;
  for (const h of hyps) {
    const r = results.find((x) => x.hypothesisId === h.id);
    const code = codeIssues.get(h.id) ?? [];
    const current = h.classification as Classification;
    // The validator may only lower a class, never raise it.
    let cls = r && CLASS_RANK[r.classification] < CLASS_RANK[current] ? r.classification : current;
    let status = h.status;
    if (!r) status = "supported"; // unvalidated: never counts as validated
    else if (r.verdict === "reject") status = "rejected";
    else if (r.verdict === "needs_research") {
      status = "open";
      if (canRepair) for (const q of r.repairQuestions) repair.push({ hypothesisId: h.id, question: q.question, query: q.query });
    } else status = "validated";
    if (code.length && status === "validated") {
      status = "supported";
      cls = CLASS_RANK[cls] > CLASS_RANK.relevant_development ? "relevant_development" : cls;
    }
    const note = [r ? `${r.verdict}${r.issues.length ? `: ${r.issues.join("; ")}` : ""}` : "not validated (validator unavailable)", ...code].join(" · ").slice(0, 900);
    await db.hypothesis.update({ where: { id: h.id }, data: { classification: cls, status, validatorNote: note, alternatives: r?.alternatives.length ? r.alternatives : h.alternatives } });
  }
  const rounds = previousRounds + 1;
  await logEvent(ctx, { accountId: account.id, stage: S, step: "investigate.validate", outcome: results.length ? "pass" : "info", reason: `${results.filter((r) => r.verdict === "upheld").length} upheld, ${results.filter((r) => r.verdict === "downgrade").length} downgraded, ${results.filter((r) => r.verdict === "reject").length} rejected, ${repair.length} repair question(s)` });
  return { repair, rounds, record: { model, rounds, results: results.map((r) => ({ ...r, codeIssues: codeIssues.get(r.hypothesisId) ?? [] })) } };
}

/** Validated opportunities and explicit intent: what readiness may rely on. */
export async function validatedConclusions(accountId: string) {
  return db.hypothesis.findMany({ where: { accountId, status: "validated", classification: { in: ["supported_opportunity", "direct_intent"] } } });
}

export { CLASSIFICATIONS };
