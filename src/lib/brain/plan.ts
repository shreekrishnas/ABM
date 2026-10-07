// Research Director: the brain decides how each question is searched, with which
// engine, and what it expects to learn. Code keeps the guardrails: high-importance
// questions can't be dropped, engines must exist, queries must name the company.

import type { Account } from "@prisma/client";
import { CONFIG } from "@/lib/config";
import { seller } from "@/lib/seller";
import { queryFor } from "@/lib/adapters/live/research";
import { BudgetExceeded, charge, logEvent, type RunContext } from "@/lib/pipeline/context";
import { rulePlan } from "./rules";
import { engineRouting } from "./insights";
import type { ImportedContext, PlanResearchOutput } from "./types";

export interface DirectedQuestion {
  key: string;
  question: string;
  importance: "high" | "medium" | "low";
  query?: string;
  engine?: string;
  why?: string;
}

export function mergePlan(
  candidates: DirectedQuestion[],
  plan: PlanResearchOutput,
  engines: string[],
  company: string,
  routing: Record<string, string> = {},
): { questions: DirectedQuestion[]; skipped: { key: string; reason: string }[] } {
  const first = company.toLowerCase().split(/\s+/)[0];
  const questions: DirectedQuestion[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const c of candidates) {
    const skip = plan.skip.find((s) => s.key === c.key);
    if (skip && c.importance !== "high" && !plan.questions.some((q) => q.key === c.key)) {
      skipped.push({ key: c.key, reason: `Brain: ${skip.reason}` });
      continue;
    }
    const d = plan.questions.find((q) => q.key === c.key);
    const query = d && d.query.toLowerCase().includes(first) ? d.query.slice(0, 240) : queryFor(c.key, company).q;
    const engine = d && engines.includes(d.engine) ? d.engine : routing[c.key] && engines.includes(routing[c.key]) ? routing[c.key] : undefined;
    questions.push({ ...c, query, engine, why: d?.why ?? c.question });
  }
  return { questions, skipped };
}

export async function directResearch(account: Account, candidates: DirectedQuestion[], known: { key: string; claim: string; status: string }[], ctx: RunContext, imported?: ImportedContext) {
  if (!candidates.length) return { questions: candidates, skipped: [], hypotheses: [] as string[], planner: "none" };
  const sp = seller();
  const engines = ctx.adapters.research.engines();
  const routing = await engineRouting();
  const input = {
    company: { name: account.name, domain: account.domain, industry: account.industry, employees: account.employees, country: account.country, technologies: account.technologies, fitScore: account.fitScore, fitReasons: account.fitReasons },
    seller: { name: sp.name, summary: sp.summary, useCases: sp.useCases.map((u) => ({ key: u.key, name: u.name, pains: u.pains })), triggers: sp.triggers.map((t) => ({ key: t.key, label: t.label })) },
    imported,
    candidates: candidates.map((c) => ({ key: c.key, question: c.question, importance: c.importance })),
    known,
    engines,
    routing,
  };
  let plan: PlanResearchOutput;
  let planner = ctx.adapters.llm.model;
  try {
    await charge(account.id, account.tier, "llm", CONFIG.costsUsd.llmBrain, "Brain: plan research", 5);
    plan = await ctx.adapters.llm.planResearch(input);
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) {
      await logEvent(ctx, { accountId: account.id, stage: 5, step: "brain.plan", outcome: "error", reason: `Brain planner failed, using rules: ${e instanceof Error ? e.message.slice(0, 200) : e}` });
    }
    plan = rulePlan(input);
    planner = "rules";
  }
  const merged = mergePlan(candidates, plan, engines, account.name, routing);
  return { ...merged, hypotheses: plan.hypotheses.slice(0, 4), planner };
}
