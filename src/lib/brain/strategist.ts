// Strategist: connects an account's facts to the seller's use cases, gives every
// buying role its own angle, and records hypotheses, risks and the next best action.

import type { Account, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { seller, sellerContext } from "@/lib/seller";
import { BudgetExceeded, charge, logEvent, type RunContext } from "@/lib/pipeline/context";
import type { TwinSnapshot } from "@/lib/pipeline/stages/research";
import { ruleBrief } from "./rules";
import { latestLearnings } from "./insights";
import { importContext } from "@/lib/research/intake";
import { ROLES, type AccountBriefData, type BriefInput } from "./types";

/** Drop anything the model cited that we don't hold, and fix indices after dropping. */
export function sanitizeBrief(b: AccountBriefData, factIds: Set<string>, useCaseKeys: string[]): AccountBriefData {
  const kept: AccountBriefData["painPoints"] = [];
  const remap = new Map<number, number>();
  b.painPoints.forEach((p, i) => {
    const ids = p.factIds.filter((id) => factIds.has(id));
    if (!ids.length || !useCaseKeys.includes(p.useCase)) return;
    remap.set(i, kept.length);
    kept.push({ ...p, factIds: ids });
  });
  const personaAngles = b.personaAngles
    .filter((a) => (ROLES as readonly string[]).includes(a.role))
    .map((a) => ({ ...a, painIndex: remap.get(a.painIndex) ?? 0 }))
    .filter(() => kept.length > 0);
  const whyNowIds = b.whyNow?.factIds.filter((id) => factIds.has(id)) ?? [];
  return {
    ...b,
    whyNow: b.whyNow && whyNowIds.length ? { text: b.whyNow.text, factIds: whyNowIds } : null,
    painPoints: kept,
    personaAngles,
    verdict: kept.length === 0 && b.verdict === "strong" ? "moderate" : b.verdict,
  };
}

export interface StoredBrief extends AccountBriefData {
  model: string;
  version: number;
}

export async function latestBrief(accountId: string): Promise<StoredBrief | null> {
  const row = await db.accountBrief.findFirst({ where: { accountId }, orderBy: { version: "desc" } });
  return row ? { ...(row.brief as unknown as AccountBriefData), model: row.model, version: row.version } : null;
}

export async function buildBrief(account: Account, snap: TwinSnapshot, ctx: RunContext): Promise<StoredBrief | null> {
  const S = 7;
  const facts = snap.facts.filter((f) => f.status === "verified" || f.status === "probable");
  if (!facts.length) {
    await logEvent(ctx, { accountId: account.id, stage: S, step: "brain.brief", outcome: "info", reason: "No usable facts yet — no brief" });
    return null;
  }
  const sp = seller();
  const plan = await db.researchPlan.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } });
  const input: BriefInput = {
    company: { name: account.name, domain: account.domain, industry: account.industry, employees: account.employees, country: account.country, technologies: account.technologies, fitScore: account.fitScore, fitReasons: account.fitReasons },
    facts: facts.map((f) => ({ id: f.id, key: f.key, claim: f.claim, status: f.status, sourceType: f.sourceType })),
    inferences: snap.inferences.map((i) => i.text),
    negatives: snap.negatives.map((n) => n.claim),
    unknowns: snap.unknowns,
    hypotheses: plan?.hypotheses ?? [],
    seller: {
      name: sp.name,
      products: sp.products,
      useCases: sp.useCases,
      personas: sp.personas.map((p) => ({ role: p.role, titles: p.titles, why: p.why })),
      proofPoints: sp.proofPoints.map((p) => p.text),
      competitors: sp.competitors.map((c) => ({ name: c.name, angle: c.angle })),
    },
    learnings: await latestLearnings(),
    imported: await importContext(account),
  };
  let raw: AccountBriefData;
  let model = ctx.adapters.llm.model;
  try {
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmBrain, "Brain: account brief", S);
    raw = await ctx.adapters.llm.accountBrief(input);
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) {
      await logEvent(ctx, { accountId: account.id, stage: S, step: "brain.brief", outcome: "error", reason: `Brain brief failed, using rules: ${e instanceof Error ? e.message.slice(0, 200) : e}` });
    }
    raw = ruleBrief(input);
    model = "rules";
  }
  const brief = sanitizeBrief(raw, new Set(facts.map((f) => f.id)), sp.useCases.map((u) => u.key));
  const dropped = raw.painPoints.length - brief.painPoints.length;
  const prev = await db.accountBrief.findFirst({ where: { accountId: account.id }, orderBy: { version: "desc" } });
  const version = (prev?.version ?? 0) + 1;
  await db.accountBrief.create({ data: { sellerId: sellerContext().pack.id, sellerPackVersion: sellerContext().version, accountId: account.id, version, brief: brief as unknown as Prisma.InputJsonValue, model } });
  if (brief.painPoints[0]) await db.account.update({ where: { id: account.id }, data: { useCase: brief.painPoints[0].useCase } });
  await logEvent(ctx, {
    accountId: account.id, stage: S, step: "brain.brief", outcome: "pass",
    reason: `${brief.verdict} — ${brief.painPoints.length} pain point(s), ${brief.personaAngles.length} persona angle(s)${dropped ? `; ${dropped} unsupported pain point(s) dropped` : ""}`,
    data: { model, version },
  });
  return { ...brief, model, version };
}

export interface ChosenAngle {
  pain: string;
  capability: string;
  useCase: string;
  persona: string;
  factIds: string[];
}

/**
 * Pain point per person. Each person starts from their role's angle; if a colleague
 * at the same company already has that pain point, they get the next unused one, so
 * the company never receives the same email twice (until pain points run out).
 */
export function assignPainPoints(brief: AccountBriefData | null, colleagues: { id: string; role: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = brief?.painPoints.length ?? 0;
  if (!brief || !n) return out;
  const used = new Set<number>();
  for (const c of colleagues) {
    const base = brief.personaAngles.find((a) => a.role === c.role)?.painIndex ?? 0;
    let pick = base % n;
    for (let k = 0; k < n; k++) {
      const i = (base + k) % n;
      if (!used.has(i)) {
        pick = i;
        break;
      }
    }
    if (used.size >= n) used.clear(); // every pain used once — start a new round
    used.add(pick);
    out.set(c.id, pick);
  }
  return out;
}

export function pickAngle(brief: AccountBriefData | null, role: string, painIndex: number): ChosenAngle | null {
  if (!brief || !brief.painPoints.length) return null;
  const pa = brief.personaAngles.find((a) => a.role === role);
  const pain = brief.painPoints[painIndex % brief.painPoints.length];
  return { pain: pain.pain, capability: pa ? `${pain.capability} (${pa.angle})` : pain.capability, useCase: pain.useCase, persona: role.replace("_", " "), factIds: pain.factIds };
}
