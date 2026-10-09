// Stages 10–11: Readiness Gate, Draft & Review.

import type { Account, Contact, Prisma } from "@prisma/client";
import { isTriggerKey } from "@/lib/research/keys";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { bannedClaimGate, specificityGate, complianceGate, decideReadiness, factGuardrail, needsHumanApproval, type Claim } from "../gates";
import { addToWatchlist, BudgetExceeded, charge, isSuppressed, logEvent, openReview, StopRun, type RunContext } from "../context";
import { contactFields } from "../fields";
import { liveEvidence } from "./research";
import { seller, sellerContext } from "@/lib/seller";
import { classifyTrigger, pickUseCase } from "@/lib/seller/fit";
import { assignPainPoints, latestBrief, pickAngle } from "@/lib/brain/strategist";
import { latestLearnings } from "@/lib/brain/insights";
import type { ClaimCheckResult } from "@/lib/brain/types";
import type { DraftInput } from "@/lib/adapters/types";
import { publish } from "@/lib/brain/bus";
import { decide } from "@/lib/brain/decisions";
import { readIntent } from "@/lib/brain/intent";
import { checkPlay, messageBody, playFor, type PlayKey } from "@/lib/knowledge/playbook";
import { knowledgeTrace, writingContext } from "@/lib/knowledge/select";
import { retrieveForMessage } from "@/lib/knowledge/rag/for-message";

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
      // Verified mailbox, or a domain that accepts email (free MX check) — never a guess.
      emailDeliverable: f.email?.status === "verified" || (f.email?.status === "probable" && f.email?.source === "mailbox_check"),
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

/** First, middle or last email of the person's sequence → which email play to write. */
export async function emailPlayFor(contactId: string, stepOrder: number): Promise<PlayKey> {
  const e = await db.enrollment.findFirst({ where: { contactId }, orderBy: { createdAt: "desc" }, include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } } } });
  const emails = (e?.sequence.steps ?? []).filter((s) => s.channel === "email").map((s) => s.order);
  return playFor("email", stepOrder, { firstOfChannel: emails.length === 0 || stepOrder <= emails[0], lastOfChannel: emails.length > 1 && stepOrder === emails[emails.length - 1] }).key;
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
  const input: DraftInput = {
    firstName: contact.firstName, title: contact.titleNormalized, company: account.name, stepOrder, instruction,
    facts: facts.map((f) => ({ id: f.id, key: f.key, claim: f.claim })), sender: sp.sender,
    seller: { name: sp.name, pitch: (useCase && sp.messaging.byUseCase[useCase]) || sp.messaging.default, cta: sp.messaging.cta, useCase },
    angle: angle ? { pain: angle.pain, capability: angle.capability, persona: contact.titleNormalized ?? angle.persona, whyNow: brief?.whyNow?.text ?? null, proofPoint: proof?.text ?? null } : null,
    learnings: await latestLearnings(),
  };
  const sc = sellerContext();
  // This person's converging signals (their own LinkedIn conversation and engagement + the company's) decide the opening.
  const intent = await readIntent(account.id, ctx.now, contact.id);
  input.signals = intent.signals.filter((s) => s.strength > 0 && s.family !== "team_context").slice(0, 3).map((s) => s.label);
  if (input.angle && intent.whyNow && intent.level !== "cold") input.angle.whyNow = intent.whyNow;
  input.tone = sp.tone;
  input.bannedClaims = sp.bannedClaims;
  // Writing knowledge: the play for this step, the recipient's persona profile, the closest examples.
  const writing = writingContext(sp.writing, {
    play: await emailPlayFor(contact.id, stepOrder),
    recipient: { buyingRole: contact.buyingRole, function: contact.function, title: contact.titleNormalized ?? contact.title },
    useCase: useCase ?? null,
    trigger: trigger?.key ?? null,
  });
  // Knowledge base (RAG): reference knowledge and any uploaded or learned examples for this play.
  const rag = await retrieveForMessage({ sp, writing, recipientTitle: contact.titleNormalized ?? contact.title, company: account.name, trigger: trigger ? { key: trigger.key, label: trigger.label } : null, useCase: useCase ?? null, leadFact: facts[0]?.claim ?? null });
  writing.references = rag.references;
  if (rag.examples.length) writing.examples = [...rag.examples.map((h) => ({ id: h.chunkId, quality: "good" as const, body: h.text.split("\n").slice(1).join("\n"), why: h.origin === "learned" ? "Got a positive reply" : `Added by the team: ${h.title}` })), ...writing.examples].slice(0, 4);
  if (rag.error) await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.knowledge", outcome: "info", reason: `Knowledge base unavailable, writing without it: ${rag.error.slice(0, 200)}` });
  else await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.knowledge", outcome: "pass", reason: `Knowledge: ${writing.play.label}${writing.persona ? ` · ${writing.persona.name}` : ""} · ${rag.references.length} reference(s)${rag.references.length ? ` (${rag.references.map((r) => r.title).slice(0, 3).join("; ")})` : ""}${rag.examples.length ? ` · ${rag.examples.length} learned/uploaded example(s)` : ""}` });
  input.channel = "email";
  input.writing = writing;
  // The claim checker sees each fact with the exact quote from its source page.
  const factText = new Map(facts.map((f) => [f.id, f.quote ? `${f.claim} (source says: "${f.quote}")` : f.claim]));
  const usable = facts.map((f) => ({ id: f.id, status: f.status, publishedAt: f.publishedAt, key: f.key }));

  // Writer → critic panel → rewriter. The brain revises its own email until every
  // critic passes or the loop cap is reached; code sets the cap.
  type Panel = { critic: string; pass: boolean; issues: string[]; available: boolean };
  let attempt = 0;
  let current: Awaited<ReturnType<typeof ctx.adapters.llm.draft>> | null = null;
  let panel: Panel[] = [];
  let checks: ClaimCheckResult[] | null = null;
  let strengths: string[] = [];
  let issues: string[] = [];
  while (attempt < CONFIG.loops.maxDraftVersions) {
    attempt++;
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmStrong, `Draft step ${stepOrder} for ${contact.fullName} (version ${attempt})`, S);
    const revise = current && issues.length ? { subject: current.subject, body: current.body, issues } : null;
    const candidate = await ctx.adapters.llm.draft({ ...input, revise }, attempt);
    if (revise) await publish(ctx, { type: "draft.rewritten", module: "rewriter", accountId: account.id, payload: { contactId: contact.id, version: attempt, fixing: issues } });
    current = candidate;
    panel = [];
    checks = null;

    // 1. Truth critic (code): every claim cites a usable, fresh fact.
    const g = factGuardrail(candidate.claims as Claim[], usable, ctx.now);
    await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.fact_guardrail", outcome: g.pass ? "pass" : "block", reason: `Version ${attempt}: ${g.reason}` });
    panel.push({ critic: "truth (code)", pass: g.pass, issues: g.pass ? [] : [g.reason], available: true });

    // 2. Truth critic (model): does each cited fact, with its quote, say what the claim says?
    if (g.pass) {
      try {
        await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, `Claim check for ${contact.fullName} (version ${attempt})`, S);
        const res = await ctx.adapters.llm.checkClaims(candidate.claims.map((c) => ({ text: c.text, facts: c.factIds.map((id) => ({ id, claim: factText.get(id) ?? "" })) })));
        checks = candidate.claims.map((c, i) => {
          const r = res.find((x) => x.index === i);
          return { text: c.text, supported: r?.supported ?? false, reason: r?.reason ?? "Not checked" };
        });
      } catch (e) {
        if (e instanceof BudgetExceeded) throw e;
      }
      const bad = checks?.filter((c) => !c.supported) ?? [];
      await logEvent(ctx, {
        accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.claim_check", outcome: checks == null ? "info" : bad.length ? "block" : "pass",
        reason: checks == null ? "Claim checker unavailable — a person will review" : bad.length ? `Version ${attempt}: unsupported — ${bad.map((b) => `"${b.text.slice(0, 60)}" (${b.reason})`).join("; ")}` : `Version ${attempt}: all ${checks.length} claim(s) supported`,
      });
      panel.push({ critic: "truth (model)", pass: checks != null && !bad.length, issues: bad.map((b) => `Claim not supported by its source: "${b.text.slice(0, 80)}" — ${b.reason}`), available: checks != null });
    }

    // 2b. Playbook critic (code): length, subject, one ask, no filler — the measurable parts of the play.
    const pc = checkPlay(writing.play, { subject: candidate.subject, body: messageBody(candidate.body, sp.sender.name) });
    panel.push({ critic: "playbook (code)", pass: pc.pass, issues: pc.issues, available: true });

    // 3. Compliance critic (code): unsubscribe line, sender address, banned claims.
    const comp = complianceGate(candidate.body);
    const ban = bannedClaimGate(`${candidate.subject}\n${candidate.body}`, sp.bannedClaims);
    // 4. Specificity critic (code): no stock phrases; must use what is only true of this company.
    const cited = candidate.claims.flatMap((c) => c.factIds).map((id) => facts.find((f) => f.id === id)?.claim ?? "").filter(Boolean);
    const spec = specificityGate(candidate.body.split(`\n\n${sp.sender.name}`)[0], account.name, cited);
    panel.push({ critic: "specificity (code)", pass: spec.pass, issues: spec.pass ? [] : [spec.reason], available: true });
    panel.push({ critic: "compliance (code)", pass: comp.pass && ban.pass, issues: [comp, ban].filter((x) => !x.pass).map((x) => x.reason), available: true });

    // 4. Style and relevance critic (model): tone, role, angle, length.
    try {
      await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmCheap, `Critique for ${contact.fullName} (version ${attempt})`, S);
      const c = await ctx.adapters.llm.critiqueDraft({
        subject: candidate.subject, body: candidate.body, company: account.name, recipientTitle: contact.titleNormalized, angle: angle ? `${angle.pain} → ${angle.capability}` : null, tone: sp.tone, bannedClaims: sp.bannedClaims,
        play: writing.playBrief, persona: writing.persona ? `${writing.persona.name} — cares about: ${writing.persona.cares.join("; ")}` : undefined,
      });
      strengths = c.strengths;
      panel.push({ critic: "style (model)", pass: c.pass && c.issues.length === 0, issues: c.issues, available: true });
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      panel.push({ critic: "style (model)", pass: true, issues: [], available: false });
    }

    issues = panel.flatMap((p) => (p.pass ? [] : p.issues));
    await publish(ctx, { type: "draft.critiqued", module: "critic_panel", accountId: account.id, payload: { contactId: contact.id, version: attempt, panel } });
    await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.critic_panel", outcome: issues.length ? "block" : "pass", reason: issues.length ? `Version ${attempt}: ${issues.length} issue(s) — ${issues.slice(0, 2).join("; ").slice(0, 300)}${attempt < CONFIG.loops.maxDraftVersions ? " → rewriting" : ""}` : `Version ${attempt}: every critic passed` });
    if (!issues.length) break;
  }

  const critique = panel as unknown as Prisma.InputJsonValue;
  if (issues.length || !current) {
    const blocked = await db.draft.create({
      data: { sellerId: sc.pack.id, sellerPackVersion: sc.version, contactId: contact.id, stepOrder, subject: current?.subject ?? "(blocked)", body: current?.body ?? "", claims: (current?.claims ?? []) as unknown as Prisma.InputJsonValue, status: "blocked", guardrailAttempts: attempt, rewrites: attempt - 1, critique, blockReason: issues[0] ?? "No draft", knowledge: knowledgeTrace(writing) },
    });
    await decide(ctx, {
      module: "critic_panel", question: `Send step ${stepOrder} to ${contact.fullName}?`, choice: "Hold — a person decides",
      caseFor: strengths.join("; ") || "Draft is built on the account's sourced facts",
      caseAgainst: issues.join("; "), evidenceFor: (current?.claims ?? []).flatMap((c) => c.factIds), evidenceAgainst: issues,
      confidence: 0.3, autonomy: "needs_human", accountId: account.id, contactId: contact.id, draftId: blocked.id,
    });
    await openReview({ type: "guardrail_failed", stage: S, accountId: account.id, contactId: contact.id, draftId: blocked.id, reason: `Still failing after ${attempt} version(s): ${issues[0] ?? ""}`.slice(0, 300) });
    return blocked;
  }

  const out = current;
  // A critic that could not run means a person reviews it, whatever the autonomy level.
  const criticDown = panel.some((p) => !p.available) || checks == null;
  const human = needsHumanApproval(account.tier, sp.autonomy) || criticDown;
  const draft = await db.draft.create({
    data: {
      sellerId: sc.pack.id, sellerPackVersion: sc.version,
      contactId: contact.id, stepOrder, subject: out.subject, body: out.body, angle: trigger?.key ?? out.angle,
      painPoint: angle?.pain ?? null, useCase, claimCheck: (checks ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      claims: out.claims as unknown as Prisma.InputJsonValue, leadEvidenceId: out.claims[0]?.factIds[0] ?? null,
      guardrailAttempts: attempt, rewrites: attempt - 1, critique, knowledge: knowledgeTrace(writing),
      status: human ? "pending_review" : "approved",
      reviewedAt: !human ? ctx.now : null,
      reviewerNote: !human ? `Auto-approved (${sp.autonomy}: every critic passed)` : null,
    },
  });
  const supported = checks ? checks.filter((c) => c.supported).length / Math.max(1, checks.length) : 0.5;
  await decide(ctx, {
    module: "main_brain", question: `Send step ${stepOrder} to ${contact.fullName}?`,
    choice: human ? "Ready — waiting for a person to approve" : "Approved by the brain",
    caseFor: [`Every critic passed on version ${attempt}`, ...strengths].join("; "),
    caseAgainst: [criticDown ? "A critic could not run" : "", angle ? `The pain point is a hypothesis: ${angle.pain}` : "", attempt > 1 ? `Needed ${attempt - 1} rewrite(s)` : ""].filter(Boolean).join("; ") || "No open risks found",
    evidenceFor: out.claims.flatMap((c) => c.factIds), evidenceAgainst: [],
    confidence: criticDown ? 0.5 : Math.min(0.95, 0.6 + 0.35 * supported - 0.05 * (attempt - 1)),
    autonomy: human ? "needs_human" : "acted", accountId: account.id, contactId: contact.id, draftId: draft.id,
  });
  if (human) {
    await openReview({ type: "draft_approval", stage: S, accountId: account.id, contactId: contact.id, draftId: draft.id, reason: `Step ${stepOrder} draft for ${contact.fullName} (${account.tier})`, dueInHours: 24 });
  }
  await publish(ctx, { type: "draft.ready", module: "writer", accountId: account.id, payload: { contactId: contact.id, draftId: draft.id, versions: attempt, needsHuman: human } });
  await logEvent(ctx, { accountId: account.id, contactId: contact.id, stage: S, step: "draft_review.human_review", outcome: "pass", reason: human ? `Queued for approval (${criticDown ? "a critic could not run" : sp.autonomy})` : `Auto-approved (${sp.autonomy})` });
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
