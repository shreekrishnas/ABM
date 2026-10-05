// Pure scoring functions: fit, data confidence, research priority, tier,
// engagement decay and buying stage. No database access.

import { CONFIG } from "@/lib/config";
import type { BuyingStage, FieldStatus, Priority, Tier } from "@prisma/client";

export interface Firmographics {
  industry?: string | null;
  employees?: number | null;
  country?: string | null;
}

export interface FitResult {
  /** 0–100, scored only on known fields (unknown ≠ bad fit). Null if nothing is known. */
  fit: number | null;
  /** Share of ICP fields known (0–1); feeds data confidence. */
  coverage: number;
  breakdown: { industry: number | null; size: number | null; region: number | null };
}

export function scoreFit(f: Firmographics, icp = CONFIG.icp): FitResult {
  const w = icp.weights;
  const industry = f.industry ? (icp.industries.some((i) => f.industry!.toLowerCase().includes(i)) ? w.industry : 0) : null;
  let size: number | null = null;
  if (f.employees != null) {
    const { min, max } = icp.employees;
    if (f.employees >= min && f.employees <= max) size = w.size;
    else if (f.employees >= min * 0.5 && f.employees <= max * 2) size = Math.round(w.size / 2);
    else size = 0;
  }
  const region = f.country ? ((icp.countries as readonly string[]).includes(f.country.toUpperCase()) ? w.region : 0) : null;

  const parts = [
    [industry, w.industry],
    [size, w.size],
    [region, w.region],
  ] as const;
  const known = parts.filter(([v]) => v !== null);
  const knownMax = known.reduce((a, [, max]) => a + max, 0);
  const got = known.reduce((a, [v]) => a + (v ?? 0), 0);
  const fit = knownMax === 0 ? null : Math.round((got / knownMax) * 100);
  return { fit, coverage: known.length / parts.length, breakdown: { industry, size, region } };
}

const STATUS_WEIGHT: Record<FieldStatus, number> = {
  verified: 1,
  probable: 0.7,
  stale: 0.3,
  conflicting: 0,
  invalid: 0,
  unknown: 0,
};

/** How much of what we hold is trustworthy, 0–1. Kept separate from fit. */
export function dataConfidence(statuses: FieldStatus[], coverage = 1): number {
  if (statuses.length === 0) return Number((0.2 * coverage).toFixed(2));
  const avg = statuses.reduce((a, s) => a + STATUS_WEIGHT[s], 0) / statuses.length;
  return Number((avg * (0.5 + 0.5 * coverage)).toFixed(2));
}

export function tierFor(fit: number): Tier {
  if (fit >= CONFIG.fit.tiers.T1) return "T1";
  if (fit >= CONFIG.fit.tiers.T2) return "T2";
  return "T3";
}

/**
 * High fit raises priority; low confidence raises it too (there is more to learn
 * that could change the decision); intent raises it.
 */
export function researchPriority(fit: number, confidence: number, intent: number): { priority: Priority; score: number } {
  const p = CONFIG.priority;
  const score = Math.round(fit * p.fitWeight + (1 - confidence) * p.gapWeight + intent * p.intentWeight);
  const priority: Priority = score >= p.high ? "high" : score >= p.medium ? "medium" : "low";
  return { priority, score };
}

export interface ScoredSignal {
  points: number;
  occurredAt: Date;
  attributed: boolean;
  anonymous: boolean;
}

export function decayed(points: number, occurredAt: Date, now: Date, halfLifeDays = CONFIG.engagement.halfLifeDays): number {
  const ageDays = Math.max(0, (now.getTime() - occurredAt.getTime()) / 86_400_000);
  return points * Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Account-level engagement: everything from everyone at the account, decayed.
 * Unattributed or anonymous activity counts at a reduced weight instead of zero.
 */
export function accountEngagement(signals: ScoredSignal[], now = new Date()): number {
  const w = CONFIG.engagement.unattributedWeight;
  const total = signals.reduce((a, s) => a + decayed(s.points, s.occurredAt, now) * (s.attributed && !s.anonymous ? 1 : w), 0);
  return Math.round(Math.min(100, total) * 10) / 10;
}

/** Person-level score: only activity from people we actually contacted. */
export function personEngagement(signals: ScoredSignal[], now = new Date()): number {
  const total = signals.filter((s) => s.attributed && !s.anonymous).reduce((a, s) => a + decayed(s.points, s.occurredAt, now), 0);
  return Math.round(Math.min(100, total) * 10) / 10;
}

const TERMINAL: BuyingStage[] = ["OPPORTUNITY", "CUSTOMER", "DISQUALIFIED"];

/**
 * Buying stage from engagement. Stages only move forward through the engagement
 * ladder; terminal stages are set explicitly by the CRM or the pipeline.
 */
export function stageFromEngagement(current: BuyingStage, score: number): BuyingStage {
  if (TERMINAL.includes(current)) return current;
  const s = CONFIG.engagement.stages;
  const ladder: BuyingStage[] = ["UNAWARE", "AWARE", "ENGAGED", "MQA"];
  const target: BuyingStage = score >= s.MQA ? "MQA" : score >= s.ENGAGED ? "ENGAGED" : score >= s.AWARE ? "AWARE" : "UNAWARE";
  if (current === "WATCH" || current === "RECYCLED") return score >= s.ENGAGED ? target : current;
  return ladder.indexOf(target) > ladder.indexOf(current) ? target : current;
}

export function identityConfidence(statuses: FieldStatus[]): number {
  if (statuses.length === 0) return 0;
  const ok = statuses.filter((s) => s === "verified" || s === "probable").length;
  return Number((ok / statuses.length).toFixed(2));
}
