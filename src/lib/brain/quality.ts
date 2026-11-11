// Research quality, measured from what happened rather than asked of the AI. These are the
// figures the architecture asks for; the accuracy target is judged against a labelled benchmark
// (npm run bench), not against these live rates alone.

import { db } from "@/lib/db";
import type { MetricKey } from "@/lib/metrics";

export interface QualityFigure {
  key: MetricKey;
  label: string;
  value: string;
  detail: string;
  /** True when there is too little data to read anything into it. */
  thin: boolean;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const MIN = 10;

export async function researchQuality(): Promise<QualityFigure[]> {
  const [facts, flagged, full, runs, complete, latencyRows, direct, directValidated, hyps, linkTotal, linkAssumed, drafts, auditFails, rejections, overturned, spend, useful] = await Promise.all([
    db.evidence.count({ where: { isNegative: false } }),
    db.evidence.count({ where: { isNegative: false, flagged: true, flagReason: { not: { startsWith: "Set aside" } } } }),
    db.evidence.count({ where: { fullText: true } }),
    db.researchRun.count({ where: { status: { not: "in_progress" } } }),
    db.researchRun.count({ where: { status: "complete" } }),
    db.researchRun.findMany({ where: { finishedAt: { not: null } }, select: { createdAt: true, finishedAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.hypothesis.count({ where: { classification: "direct_intent" } }),
    db.hypothesis.count({ where: { classification: "direct_intent", status: "validated" } }),
    db.hypothesis.count(),
    db.evidenceLink.count(),
    db.evidenceLink.count({ where: { isHypothesis: true } }),
    db.draft.count(),
    db.draft.findMany({ select: { critique: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
    db.reviewItem.count({ where: { type: "proposed_rejection", status: "resolved" } }),
    db.reviewItem.count({ where: { type: "proposed_rejection", status: "resolved", resolution: { startsWith: "Kept" } } }),
    db.ledgerEntry.aggregate({ _sum: { amountMicros: true } }),
    db.hypothesis.findMany({ where: { status: "validated", classification: { in: ["supported_opportunity", "direct_intent"] } }, distinct: ["accountId"], select: { accountId: true } }),
  ]);
  const evidenceTotal = await db.evidence.count();
  // Reviewed facts: a person said "Looks right" or marked it wrong. Only these measure accuracy.
  const [checked, usableConf, dated, scored] = await Promise.all([
    db.evidence.count({ where: { isNegative: false, checkedAt: { not: null }, flagged: false } }),
    db.evidence.aggregate({ where: { isNegative: false, flagged: false, supersededById: null, status: { in: ["verified", "probable"] }, confidence: { not: null } }, _avg: { confidence: true }, _count: true }),
    db.evidence.count({ where: { isNegative: false, eventDate: { not: null } } }),
    db.evidence.count({ where: { isNegative: false, confidence: { not: null } } }),
  ]);
  const reviewed = checked + flagged;
  // A draft counts when any critic found an unsupported statement about the prospect, in any version.
  const unsupported = /Unsupported statement about the prospect|Claim not supported by its source|States a guess as fact/;
  const auditFailCount = auditFails.filter((d) => unsupported.test(JSON.stringify(d.critique ?? ""))).length;
  const mins = latencyRows.map((r) => (r.finishedAt!.getTime() - r.createdAt.getTime()) / 60_000).sort((a, b) => a - b);
  const median = mins.length ? mins[Math.floor(mins.length / 2)] : null;
  const usd = (spend._sum.amountMicros ?? 0) / 1e6;
  return [
    { key: "rq_fact_precision", label: "Source-to-claim accuracy", value: pct(checked, reviewed), detail: `${checked} looked right, ${flagged} marked wrong, of ${reviewed} facts a person reviewed (${facts} facts in all)`, thin: reviewed < MIN },
    { key: "rq_confidence", label: "Average confidence", value: usableConf._count ? String(Math.round(usableConf._avg.confidence ?? 0)) : "—", detail: `Across ${usableConf._count} usable facts; 75+ is high, below 50 is low`, thin: usableConf._count < MIN },
    { key: "rq_event_dated", label: "Facts with an event date", value: pct(dated, scored), detail: `${dated} of ${scored} facts say when the event happened; the rest use the page's date`, thin: scored < MIN },
    { key: "rq_full_text", label: "Sources read in full", value: pct(full, evidenceTotal), detail: `${full} of ${evidenceTotal} facts come from the whole page, the rest from a search snippet`, thin: evidenceTotal < MIN },
    { key: "rq_completeness", label: "Research complete", value: pct(complete, runs), detail: `${complete} of ${runs} investigations passed every completeness check`, thin: runs < MIN },
    { key: "rq_direct_intent", label: "Direct-intent precision", value: pct(directValidated, direct), detail: `${directValidated} of ${direct} direct-intent conclusions upheld by the validator`, thin: direct < 3 },
    { key: "rq_links", label: "Links backed by evidence", value: pct(linkTotal - linkAssumed, linkTotal), detail: `${linkAssumed} of ${linkTotal} links are assumptions (shown as such) · ${hyps} hypotheses in all`, thin: linkTotal < MIN },
    { key: "rq_email_claims", label: "Emails held for unsupported statements", value: pct(auditFailCount, drafts), detail: `${auditFailCount} of ${drafts} drafts had a sentence about the prospect the facts don't support (caught before sending)`, thin: drafts < MIN },
    { key: "rq_overturn", label: "Proposed rejections overturned", value: pct(overturned, rejections), detail: `${overturned} of ${rejections} proposed rejections were kept by a person`, thin: rejections < 3 },
    { key: "rq_cost", label: "Cost per useful company", value: useful.length ? `$${(usd / useful.length).toFixed(2)}` : "—", detail: `$${usd.toFixed(2)} spent · ${useful.length} companies with a validated opportunity`, thin: useful.length < 3 },
    { key: "rq_latency", label: "Investigation time (median)", value: median == null ? "—" : median < 1 ? "<1 min" : `${Math.round(median)} min`, detail: `${mins.length} finished investigations`, thin: mins.length < MIN },
  ];
}
