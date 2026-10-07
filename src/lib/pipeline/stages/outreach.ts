// Stages 10–11: Readiness Gate, Draft & Review.

import type { Account, Contact, Prisma } from "@prisma/client";
import { isTriggerKey } from "@/lib/research/keys";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { complianceGate, decideReadiness, factGuardrail, needsHumanApproval, type Claim } from "../gates";
import { addToWatchlist, BudgetExceeded, charge, isSuppressed, logEvent, openReview, StopRun, type RunContext } from "../context";
import { contactFields } from "../fields";
import { liveEvidence } from "./research";
import { seller } from "@/lib/seller";
import { classifyTrigger, pickUseCase } from "@/lib/seller/fit";
import { assignPainPoints, latestBrief, pickAngle } from "@/lib/brain/strategist";
import { latestLearnings } from "@/lib/brain/insights";
import type { ClaimCheckResult } from "@/lib/brain/types";

// ───────────────────────── Stage 10 ─────────────────────────

export interface ReadinessResult {
  account: Account;
  reResearch: boolean;
  ready: number;
}

export async function s10Readiness(account: Account, ctx: RunContext): Promise<ReadinessResult> {
  const S = 10;
  const evidence = await liveEvidence(account.id);
  const accInput = {
    negatives: evidence.filter((e) => e.isNegative && e.negativeKind).map((e) => ({ kind: e.negativeKind!, publishedAt: e.publishedAt })),
    triggers: evidence.filter((e) => isTriggerKey(e.key)).map((e) => ({ status: e.status, publishedAt: e.publishedAt })),
    followupUsed: account.followupUsed,
  };
  const people = await db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null, state: { in: ["selected", "ready"] } } });

  // Account-level rules first (negative evidence, evidence strength).
  const probe = decideReadiness(accInput, {
    identity: { email: "verified", title: "verified", company: "verified" },
    buyingRole: "decision_maker", lawfulBasis: "probe", emailDeliverable: true, suppressed: false,
  }, ctx.now);

  if (probe.outcome === "disqualified") {
    await db.account.update({ where: { id: account.id }, data: { stage: "DISQUALIFIED", disqualifyReason: probe.reasons[0] } });
    await db.contact.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { readiness: "disqualified", readinessReasons: probe.reasons } });
    await logEvent(ctx, { accountId: account.id, stage: S, step: "readiness.negative_evidence", outcome: "block", reason: probe.reasons[0] });
    throw new StopRun(probe.reasons[0]);
  }
  if (probe.outcome === "watch") {
    await addToWatchlist(account.id, probe.reasons[0], probe.watchDays ?? 30, ctx.now);
    await db.account.update({ where: { id: account.id }, data: { stage: "WATCH" } });
    await db.contact.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { readiness: "watch", readinessReasons: probe.reasons } });
    await logEvent(ctx, { accountId: account.id, stage: S, step: "readiness.evidence_quality", outcome: "block", reason: `${probe.reasons[0]} — watch ${probe.watchDays}d` });
    throw new StopRun(probe.reasons[0]);
  }
  if (probe.outcome === "targeted_re_research") {
    await db.contact.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { readiness: "targeted_re_research", readinessReasons: probe.reasons } });
    await logEvent(ctx, { accountId: account.id, stage: S, step: "readiness.evidence_quality", outcome: "info", reason: `${probe.reasons[0]} — one targeted re-research pass` });
    return { account, reResearch: true, ready: 0 };
  }
  await logEvent(ctx, { accountId: account.id, stage: S, step: "readiness.evidence_quality", outcome: "pass", reason: "Evidence strong; no blocking negatives" });

  let ready = 0;
  for (const p of people) {
    const f = await contactFields(p.id);
    const decision = decideReadiness(accInput, {
      identity: { email: f.email?.status ?? "unknown", title: f.title?.status ?? "unknown", company: f.company?.status ?? "unknown" },
      buyingRole: p.buyingRole,
      lawfulBasis: p.lawfulBasis,
      emailDeliverable: f.email?.status === "verified",
      suppressed: await isSuppressed(p.email),
    }, ctx.now);
    await db.contact.update({
      where: { id: p.id },
      data: { readiness: decision.outcome, readinessReasons: decision.reasons, state: decision.outcome === "ready" ? "ready" : p.state === "ready" ? "selected" : p.state },
    });
    await logEvent(ctx, { accountId: account.id, contactId: p.id, stage: S, step: "readiness.decide", outcome: decision.outcome === "ready" ? "pass" : "block", reason: `${p.fullName}: ${decision.outcome} — ${decision.reasons.join("; ")}` });
    if (decision.outcome === "human_review") {
      await openReview({ type: decision.reasons.some((r) => r.includes("lawful")) ? "lawful_basis_missing" : "identity_conflict", stage: S, accountId: account.id, contactId: p.id, reason: `${p.fullName}: ${decision.reasons.join("; ")}` });
    }
    if (decision.outcome === "ready") {
      ready++;
      // Earlier blockers for this person no longer apply (e.g. a website or email arrived in a later upload).
      await db.reviewItem.updateMany({ where: { contactId: p.id, status: "open", type: { in: ["identity_conflict", "lawful_basis_missing"] } }, data: { status: "resolved", resolution: "Auto-resolved: person now passes readiness", resolvedAt: ctx.now } });
    }
  }
  if (ready) await db.reviewItem.updateMany({ where: { accountId: account.id, status: "open", type: "no_usable_person" }, data: { status: "resolved", resolution: "Auto-resolved: a person is now ready", resolvedAt: ctx.now } });
  if (!ready) {
    await openReview({ type: "no_usable_person", stage: S, accountId: account.id, reason: "Evidence is strong but nobody passed the readiness minimums" });
    throw new StopRun("No ready contacts");
  }
  return { account, reResearch: false, ready };
}

// ───────────────────────── Stage 11 ─────────────────────────

export async function sequenceForTier(tier: Account["tier"]) {
  return (
    (await db.sequence.findFirst({ where: { active: true, tier: tier ?? "T3" }, include: { steps: { orderBy: { order: "asc" } } } })) ??
    (await db.sequence.findFirst({ where: { active: true }, include: { steps: { orderBy: { order: "asc" } } } }))
  );
}

export async function usableFacts(accountId: string, now: Date) {
  const ev = await liveEvidence(accountId);
  return ev.filter((e) => !e.isNegative && (e.status === "verified" || e.status === "probable") && e.publishedAt.getTime() <= now.getTime());
}

/**
 * Draft one step for one contact, run the fact guardrail (regenerating up to N
 * times) and compliance, then queue for human approval or auto-approve.
 */
export async function draftForContact(account: Account, contact: Contact, stepOrder: number, instruction: string, ctx: RunContext) {
  const S = 11;
  const existing = await db.draft.findFirst({ where: { contactId: contact.id, stepOrder, status: { not: "rejected" } } });
  if (existing) return existing;

  // The brain's angle for this person: their role's pain point, rotated so colleagues
  // at the same company get different emails.
  const brief = await latestBrief(account.id);
  const colleagues: { id: string; role: string }[] = (
    await db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null, state: { in: ["ready", "in_sequence"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, buyingRole: true } })
  ).map((c) => ({ id: c.id, role: c.buyingRole }));
  if (!colleagues.some((c) => c.id === contact.id)) colleagues.push({ id: contact.id, role: contact.buyingRole });
  const assigned = assignPainPoints(brief, colleagues);
  const angle = pickAngle(brief, contact.buyingRole, assigned.get(contact.id) ?? 0);
  const angleFacts = new Set(angle?.factIds ?? []);

  // Order: the angle's facts first, then the strongest fresh trigger, verified before probable, newest first.
  const facts = (await usableFacts(account.id, ctx.now)).sort((a, b) => {
    const rank = (f: { id: string; key: string }) => (angleFacts.has(f.id) ? (isTriggerKey(f.key) ? -2 : -1) : isTriggerKey(f.key) ? 0 : f.key === "owner_function" ? 1 : 2);
    return rank(a) - rank(b) || (a.status === "verified" ? -1 : 1) - (b.status === "verified" ? -1 : 1) || b.publishedAt.getTime() - a.publishedAt.getTime();
  });
  if (!facts.some((f) => isTriggerKey(f.key))) {
    await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.choose_evidence", outcome: "block", reason: "No usable trigger fact — no draft" });
    return null;
  }
  await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.choose_evidence", outcome: "pass", reason: `Lead: ${facts[0].claim}${angle ? ` · angle: ${angle.useCase.replace(/_/g, " ")} for ${angle.persona}` : ""}` });

  // Seller messaging: the brain's use case for this person, else the trigger/industry match.
  const sp = seller();
  const trigger = classifyTrigger(facts.find((f) => isTriggerKey(f.key))!.claim, sp);
  const useCase = angle?.useCase ?? pickUseCase(account.industry, trigger?.key ?? null, sp) ?? account.useCase;
  const proof = sp.proofPoints.find((p) => useCase && p.text.toLowerCase().includes(useCase.split("_")[0])) ?? sp.proofPoints[0];
  const input = {
    firstName: contact.firstName, title: contact.titleNormalized, company: account.name, stepOrder, instruction,
    facts: facts.map((f) => ({ id: f.id, key: f.key, claim: f.claim })), sender: sp.sender,
    seller: { name: sp.name, pitch: (useCase && sp.messaging.byUseCase[useCase]) || sp.messaging.default, cta: sp.messaging.cta, useCase },
    angle: angle ? { pain: angle.pain, capability: angle.capability, persona: contact.titleNormalized ?? angle.persona, whyNow: brief?.whyNow?.text ?? null, proofPoint: proof?.text ?? null } : null,
    learnings: await latestLearnings(),
  };
  const factText = new Map(facts.map((f) => [f.id, f.claim]));
  let attempt = 0;
  let out: Awaited<ReturnType<typeof ctx.adapters.llm.draft>> | null = null;
  let checks: ClaimCheckResult[] | null = null;
  let lastReason = "";
  while (attempt < CONFIG.guardrail.maxAttempts) {
    attempt++;
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmStrong, `Draft step ${stepOrder} for ${contact.fullName} (attempt ${attempt})`, S);
    const candidate = await ctx.adapters.llm.draft(input, attempt);
    const g = factGuardrail(candidate.claims as Claim[], facts.map((f) => ({ id: f.id, status: f.status, publishedAt: f.publishedAt, key: f.key })), ctx.now);
    await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.fact_guardrail", outcome: g.pass ? "pass" : "block", reason: `Attempt ${attempt}: ${g.reason}` });
    if (!g.pass) {
      lastReason = g.reason;
      continue;
    }
    // Second, independent check: does each cited fact actually say what the claim says?
    try {
      await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, `Claim check for ${contact.fullName} (attempt ${attempt})`, S);
      const res = await ctx.adapters.llm.checkClaims(candidate.claims.map((c) => ({ text: c.text, facts: c.factIds.map((id) => ({ id, claim: factText.get(id) ?? "" })) })));
      checks = candidate.claims.map((c, i) => {
        const r = res.find((x) => x.index === i);
        return { text: c.text, supported: r?.supported ?? false, reason: r?.reason ?? "Not checked" };
      });
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      checks = null; // checker unavailable — a person must review this draft
    }
    const bad = checks?.filter((c) => !c.supported) ?? [];
    await logEvent(ctx, {
      accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.claim_check", outcome: checks == null ? "info" : bad.length ? "block" : "pass",
      reason: checks == null ? "Claim checker unavailable — sending to human review" : bad.length ? `Attempt ${attempt}: unsupported — ${bad.map((b) => `"${b.text.slice(0, 60)}" (${b.reason})`).join("; ")}` : `Attempt ${attempt}: all ${checks.length} claim(s) supported`,
    });
    if (bad.length) {
      lastReason = `Claim not supported by its source: ${bad[0].text.slice(0, 80)}`;
      continue;
    }
    out = candidate;
    break;
  }

  if (!out) {
    const blocked = await db.draft.create({
      data: { contactId: contact.id, stepOrder, subject: "(blocked)", body: "", claims: [], status: "blocked", guardrailAttempts: attempt, blockReason: lastReason },
    });
    await openReview({ type: "guardrail_failed", stage: S, accountId: account.id, contactId: contact.id, draftId: blocked.id, reason: `Fact guardrail failed ${attempt}×: ${lastReason}` });
    return blocked;
  }

  const comp = complianceGate(out.body);
  await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.compliance", outcome: comp.pass ? "pass" : "block", reason: comp.reason });
  // No completed claim check means a person reviews it, whatever the tier policy.
  const human = needsHumanApproval(account.tier) || checks == null;
  const draft = await db.draft.create({
    data: {
      contactId: contact.id, stepOrder, subject: out.subject, body: out.body, angle: trigger?.key ?? out.angle,
      painPoint: angle?.pain ?? null, useCase, claimCheck: (checks ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      claims: out.claims as unknown as Prisma.InputJsonValue, leadEvidenceId: out.claims[0]?.factIds[0] ?? null,
      guardrailAttempts: attempt,
      status: !comp.pass ? "blocked" : human ? "pending_review" : "approved",
      blockReason: comp.pass ? null : comp.reason,
      reviewedAt: !human && comp.pass ? ctx.now : null,
      reviewerNote: !human && comp.pass ? "Auto-approved (T3 policy, all checks passed)" : null,
    },
  });
  if (comp.pass && human) {
    await openReview({ type: "draft_approval", stage: S, accountId: account.id, contactId: contact.id, draftId: draft.id, reason: `Step ${stepOrder} draft for ${contact.fullName} (${account.tier})`, dueInHours: 24 });
  }
  await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.human_review", outcome: comp.pass ? "pass" : "block", reason: comp.pass ? (human ? "Queued for human approval" : "Auto-approved") : "Blocked by compliance" });
  return draft;
}

export async function s11DraftReview(account: Account, ctx: RunContext): Promise<Account> {
  const S = 11;
  const ready = await db.contact.findMany({ where: { accountId: account.id, mergedIntoId: null, state: "ready" } });
  const seq = await sequenceForTier(account.tier);
  if (!seq || seq.steps.length === 0) {
    await logEvent(ctx, { accountId: account.id, stage: S, step: "draft_review.sequence", outcome: "error", reason: "No active sequence configured" });
    throw new StopRun("No active sequence");
  }
  for (const c of ready) {
    await db.enrollment.upsert({
      where: { contactId_sequenceId: { contactId: c.id, sequenceId: seq.id } },
      create: { contactId: c.id, sequenceId: seq.id, currentStep: 1, status: "active", nextDueAt: null },
      update: {},
    });
    const first = seq.steps[0];
    if (first.channel === "email") await draftForContact(account, c, first.order, first.instruction, ctx);
  }
  return account;
}
