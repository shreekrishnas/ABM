// Rule-based brain. Used by the mock adapters (tests, sample data) and as the
// fallback when the live model fails, so the pipeline never stalls on the LLM.

import { seller } from "@/lib/seller";
import { isTriggerKey } from "@/lib/research/keys";
import { classifyTrigger, pickUseCase } from "@/lib/seller/fit";
import { queryFor } from "@/lib/adapters/live/research";
import type { AccountBriefData, BrainStats, BriefInput, ClaimToCheck, InsightSummary, PlanResearchInput, PlanResearchOutput } from "./types";

export function rulePlan(input: PlanResearchInput): PlanResearchOutput {
  const sp = seller();
  const kw = input.imported?.keywords.slice(0, 2).map((k) => `"${k}"`).join(" OR ");
  const firstUseCase = input.seller.useCases.find((u) => sp.icp.industries.some((i) => i.useCases[0] === u.key && input.company.industry && i.match.some((m) => input.company.industry!.toLowerCase().includes(m))));
  const hypotheses: string[] = [];
  if (firstUseCase) hypotheses.push(`${input.company.name} likely feels "${firstUseCase.pains.split(";")[0].trim()}" — test with trigger and partner-network evidence`);
  const talk = input.imported?.conversations[0];
  if (talk) hypotheses.push(`${talk.name} (${talk.title ?? "contact"}) is already ${talk.stage.toLowerCase()} on LinkedIn — look for the initiative behind that interest`);
  const core = input.company.technologies.find((t) => sp.icp.tech.erp.some((e) => t.toLowerCase().includes(e)));
  if (core) hypotheses.push(sp.ruleHints.techHypothesis.replace("{tech}", core));
  return {
    hypotheses,
    questions: input.candidates.map((c) => ({
      key: c.key,
      // Imported keywords narrow the trigger and expansion searches to what this company actually does.
      query: kw && isTriggerKey(c.key) ? `${queryFor(c.key, input.company.name).q} ${kw}` : queryFor(c.key, input.company.name).q,
      engine: input.routing[c.key] ?? input.engines[0] ?? "auto",
      why: c.question,
    })),
    skip: [],
  };
}

export function ruleBrief(input: BriefInput): AccountBriefData {
  const sp = seller();
  const talk = input.imported?.conversations[0];
  const triggers = input.facts.filter((f) => isTriggerKey(f.key));
  const owner = input.facts.find((f) => f.key === "owner_function");
  const network = input.facts.find((f) => f.key === "partner_network");
  const tooling = input.facts.find((f) => f.key === "tooling");

  const painPoints: AccountBriefData["painPoints"] = [];
  const seen = new Set<string>();
  for (const t of triggers.slice(0, 3)) {
    const trig = classifyTrigger(t.claim, sp);
    const uc = pickUseCase(input.company.industry, trig?.key ?? null, sp);
    const useCase = sp.useCases.find((u) => u.key === uc) ?? sp.useCases[0];
    if (seen.has(useCase.key)) continue;
    seen.add(useCase.key);
    const ids = [t.id, ...(network && useCase.key.includes("onboarding") ? [network.id] : [])];
    painPoints.push({
      pain: `${useCase.pains.split(";")[0].trim()} — likely sharper now that ${input.company.name} ${t.claim.replace(new RegExp(`^${input.company.name}\\s+`, "i"), "")}`,
      factIds: ids,
      useCase: useCase.key,
      capability: useCase.outcome,
      confidence: t.status === "verified" ? "high" : "medium",
    });
  }
  if (tooling && painPoints.length < 3) {
    const uc = sp.useCases[sp.useCases.length > 2 ? 2 : 0];
    const replaceable = [...sp.icp.tech.incumbents, ...sp.icp.tech.workflow, "excel", "manual"];
    if (uc && !seen.has(uc.key) && replaceable.some((t) => tooling.claim.toLowerCase().includes(t))) {
      painPoints.push({ pain: sp.ruleHints.toolingPain.replace("{tools}", tooling.claim.replace(/^Current stack includes /, "")), factIds: [tooling.id], useCase: uc.key, capability: uc.outcome, confidence: "medium" });
    }
  }

  const fit = input.company.fitScore ?? 0;
  const verdict: AccountBriefData["verdict"] = fit >= 80 && triggers.length ? "strong" : fit >= 60 && triggers.length ? "moderate" : "weak";
  const roleOrder = ["decision_maker", "champion", "budget_owner", "influencer"] as const;
  const personaAngles = painPoints.length
    ? roleOrder.map((role, i) => {
        const persona = input.seller.personas.find((p) => p.role === role);
        const pi = i % painPoints.length;
        return { role, angle: `${persona?.why ?? "Owns the outcome"} — lead with: ${painPoints[pi].capability}`, painIndex: pi };
      })
    : [];
  const incumbent = input.company.technologies.find((t) => sp.icp.tech.incumbents.some((x) => t.toLowerCase().includes(x.toLowerCase())));
  return {
    verdict,
    verdictWhy: `Fit ${fit}/100${input.company.fitReasons[0] ? ` (${input.company.fitReasons[0]})` : ""}; ${triggers.length} trigger fact(s)${owner ? `, ${owner.claim.toLowerCase()}` : ""}.`,
    whyNow: triggers[0] ? { text: triggers[0].claim, factIds: [triggers[0].id] } : null,
    painPoints,
    personaAngles,
    hypotheses: [...input.hypotheses.slice(0, 2), ...input.unknowns.map((u) => `Unknown — confirm in discovery: ${u.replace(/_/g, " ")}`)].slice(0, 5),
    risks: [...input.negatives.slice(0, 2), ...(incumbent ? [`Incumbent tool in stack: ${incumbent} — position against it, don't attack it`] : [])].slice(0, 5),
    nextBestAction: talk
      ? `${talk.name} (${talk.title ?? "contact"}) is ${talk.stage.toLowerCase()} on LinkedIn via ${talk.sender}${talk.lastReply ? ` ("${talk.lastReply.slice(0, 60)}")` : ""} — continue that conversation first; don't open a cold email to them`
      : verdict === "weak" ? "Keep on watch; re-check when a trigger appears" : `Reach the ${owner ? owner.claim.match(/The (\w+) team/)?.[1] ?? "owning" : "owning"} team's decision maker and champion with the ${painPoints[0]?.useCase.replace(/_/g, " ") ?? "primary"} angle`,
  };
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));

export function ruleCheckClaims(claims: ClaimToCheck[]) {
  return claims.map((c, index) => {
    const cw = words(c.text);
    const best = Math.max(0, ...c.facts.map((f) => [...words(f.claim)].filter((w) => cw.has(w)).length));
    return { index, supported: best >= 2, reason: best >= 2 ? "Wording matches the cited fact" : "Claim shares too little with the cited fact" };
  });
}

const pct = (r: number | null) => (r == null ? "n/a" : `${Math.round(r * 100)}%`);

const nice = (s: string) => s.replace(/_/g, " ");
const DIM: Record<string, string> = { byUseCase: "use case", byRole: "buying role", byTrigger: "trigger", byTier: "tier" };

export function ruleInsights(stats: BrainStats): InsightSummary {
  const enough = (n: number) => n >= stats.minSample;
  const working: InsightSummary["working"] = [];
  const notWorking: InsightSummary["notWorking"] = [];
  const recommendations: InsightSummary["recommendations"] = [];

  for (const [dim, rates] of Object.entries(stats.messaging)) {
    const ok = rates.filter((r) => enough(r.n) && r.rate != null).sort((a, b) => b.rate! - a.rate!);
    if (ok.length >= 2) {
      working.push({ text: `${nice(ok[0].label)} leads on positive replies (by ${DIM[dim] ?? dim})`, evidence: `${pct(ok[0].rate)} of ${ok[0].n} sent` });
      const worst = ok[ok.length - 1];
      if (worst.rate! < ok[0].rate!) notWorking.push({ text: `${nice(worst.label)} trails (by ${DIM[dim] ?? dim})`, evidence: `${pct(worst.rate)} of ${worst.n} sent` });
    }
  }
  const byKey = new Map<string, BrainStats["research"]>();
  for (const r of stats.research) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  for (const [key, rows] of byKey) {
    const ranked = rows.filter((r) => r.searches >= stats.minSample && r.yield != null).sort((a, b) => b.yield! - a.yield!);
    if (ranked.length >= 2 && ranked[0].yield! > ranked[ranked.length - 1].yield!) {
      recommendations.push({ area: "research", text: `Route "${nice(key)}" to ${ranked[0].engine} first (${ranked[0].yield!.toFixed(2)} facts/search vs ${ranked[ranked.length - 1].yield!.toFixed(2)} on ${ranked[ranked.length - 1].engine})` });
    }
    for (const r of rows) if (r.searches >= stats.minSample && r.kept === 0) notWorking.push({ text: `${r.engine} finds nothing usable for "${nice(key)}"`, evidence: `${r.searches} searches, 0 facts kept` });
  }
  const rv = stats.review;
  if (rv.reviewed >= stats.minSample) {
    const asIs = rv.approvedAsIs / rv.reviewed;
    (asIs >= 0.8 ? working : notWorking).push({ text: `Reviewers approve ${pct(asIs)} of drafts without edits`, evidence: `${rv.approvedAsIs}/${rv.reviewed} reviewed` });
    if (rv.rejected / rv.reviewed > 0.15) recommendations.push({ area: "messaging", text: "Read the rejected drafts' notes and tighten the angle for the weakest use case" });
  }
  if (stats.facts.total >= stats.minSample && stats.facts.flagged / stats.facts.total > 0.02) {
    recommendations.push({ area: "research", text: `Fact precision is ${pct(1 - stats.facts.flagged / stats.facts.total)} — review flagged facts and the engines that produced them` });
  }
  const fitOk = stats.fit.filter((f) => enough(f.n) && f.rate != null);
  if (fitOk.length >= 2 && fitOk[0].rate! < fitOk[fitOk.length - 1].rate!) {
    recommendations.push({ area: "targeting", text: "Lower fit bands are converting better than higher ones — revisit the ICP weights" });
  }
  // People before outcomes: reviewer verdicts and LinkedIn progress, labelled tentative on small samples.
  const tag = (r: { n: number }) => (enough(r.n) ? "" : " (tentative)");
  const revUc = (stats.reviewer?.byUseCase ?? []).filter((r) => r.n >= 3 && r.rate != null).sort((a, b) => a.rate! - b.rate!);
  if (revUc.length && revUc[0].rate! < 0.6) {
    notWorking.push({ text: `Reviewers often change "${nice(revUc[0].label)}" drafts${tag(revUc[0])}`, evidence: `${pct(revUc[0].rate)} approved as written of ${revUc[0].n}` });
    recommendations.push({ area: "messaging", text: `Rework the "${nice(revUc[0].label)}" pitch in the seller pack using reviewers' edits${tag(revUc[0])}` });
  }
  const li = (stats.linkedin?.bySender ?? []).filter((r) => r.n >= 3 && r.rate != null).sort((a, b) => b.rate! - a.rate!);
  if (li.length >= 2 && li[0].rate! > li[li.length - 1].rate!) {
    working.push({ text: `${li[0].label} gets more people to Interested on LinkedIn${tag(li[0])}`, evidence: `${pct(li[0].rate)} of ${li[0].n} vs ${pct(li[li.length - 1].rate)} of ${li[li.length - 1].n}` });
  }
  if (stats.creditsSavedUsd > 0) working.push({ text: "Search cache is avoiding repeat paid searches", evidence: `$${stats.creditsSavedUsd.toFixed(2)} saved` });
  if (!recommendations.length) recommendations.push({ area: "process", text: `Keep collecting outcomes — findings need at least ${stats.minSample} examples per group` });
  return {
    headline: working[0]?.text ?? notWorking[0]?.text ?? "Not enough outcomes yet to call what works",
    working: working.slice(0, 6),
    notWorking: notWorking.slice(0, 6),
    recommendations: recommendations.slice(0, 8),
  };
}
