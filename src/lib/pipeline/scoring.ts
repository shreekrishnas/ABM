// Pure scoring functions: fit, data confidence, research priority, tier,
// engagement decay and buying stage. No database access.

import { CONFIG } from "@/lib/config";
import type { BuyingStage, FieldStatus, Priority, Tier } from "@prisma/client";
import { seller, type SellerProfile } from "@/lib/seller";
import { sellerFit, type SellerFit } from "@/lib/seller/fit";

export interface Firmographics {
  industry?: string | null;
  employees?: number | null;
  country?: string | null;
  technologies?: string[] | null;
}

export type FitResult = SellerFit;

/**
 * Fit against the active seller's ideal customer profile. Scored on known
 * components only (unknown ≠ bad fit); coverage feeds data confidence.
 */
export function scoreFit(f: Firmographics, profile: SellerProfile = seller()): FitResult {
  return sellerFit(f, profile);
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
