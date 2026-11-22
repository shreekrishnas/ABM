// Every action Vega can take, in one list. Step 1 holds read-only (level 0) tools: the
// assistant's existing lookups plus three for the Vega page. Later levels add tools here.
import { z } from "zod";
import { db } from "@/lib/db";
import { TOOLS as LOOKUPS, redact } from "@/lib/assistant/tools";
import { openDecisions } from "@/lib/decisions";
import { contactStatuses, roleCoverage } from "@/lib/buying-group/coverage";
import { isStale } from "@/lib/pipeline/gates";
import { freshnessKindFor } from "@/lib/pipeline/stages/research";
import type { AgentTool } from "./types";
import { LEVEL1 } from "./actions-l1";
import { LEVEL2 } from "./actions-l2";
import { LEVEL3 } from "./actions-l3";

export type FactLabel = "verified" | "inferred" | "stale" | "outdated";

/** How much a fact can be relied on: what the answer must say alongside it. */
export function factLabel(e: { status: string; key: string; publishedAt: Date; supersededById?: string | null; flagged?: boolean }, now = new Date()): FactLabel {
  if (e.supersededById || e.flagged || e.status === "invalid" || e.status === "conflicting") return "outdated";
  if (e.status === "stale" || isStale(e.publishedAt, freshnessKindFor(e.key), now)) return "stale";
  return e.status === "verified" ? "verified" : "inferred";
}

const define = <S extends z.ZodTypeAny>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;

const accountOverview = define({
  name: "account_overview",
  description: "One company as Vega sees it: scores (fit, intent, priority), stage and tier, research facts each labelled verified / inferred / stale / outdated with its source, buying-group coverage by role (missing roles named), open approvals for it, and its last pipeline steps. Use it to explain why a company is (or isn't) a priority.",
  input: z.object({ accountId: z.string().min(5).max(40) }),
  level: 0,
  minRole: "viewer",
  reversible: false,
  target: ({ accountId }) => ({ accountId }),
  run: async ({ accountId }) => {
    const a = await db.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, domain: true, tier: true, stage: true, fitScore: true, intentScore: true, priorityScore: true, intentReading: true, pipelineStatus: true, disqualifyReason: true, relationship: true, updatedAt: true },
    });
    if (!a) return { found: false, accountId };
    const now = new Date();
    const [facts, people, approvals, steps] = await Promise.all([
      db.evidence.findMany({ where: { accountId }, orderBy: { publishedAt: "desc" }, take: 25, select: { id: true, key: true, claim: true, status: true, publishedAt: true, sourceUrl: true, publisher: true, supersededById: true, flagged: true } }),
      contactStatuses([accountId]),
      db.reviewItem.findMany({ where: { accountId, status: "open" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, type: true, reason: true, createdAt: true } }),
      db.pipelineEvent.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: 10, select: { step: true, outcome: true, reason: true, createdAt: true } }),
    ]);
    const coverage = roleCoverage(people.get(accountId) ?? []);
    return {
      found: true,
      account: a,
      facts: facts.map((f) => ({ id: f.id, topic: f.key, claim: f.claim, label: factLabel(f, now), date: f.publishedAt, source: f.publisher ?? f.sourceUrl, url: f.sourceUrl })),
      buyingGroup: coverage.map((r) => ({ role: r.label, status: r.status, people: r.people.map((p) => p.fullName) })),
      missingRoles: coverage.filter((r) => r.status === "missing").map((r) => r.label),
      openApprovals: approvals,
      recentSteps: steps,
      link: `/accounts/${a.id}`,
    };
  },
});

const openApprovals = define({
  name: "open_approvals",
  description: "What is waiting for a person in Approvals (emails to approve and exceptions), newest first, with counts by kind and a link to each.",
  input: z.object({ kind: z.enum(["all", "approval", "exception"]).optional(), limit: z.number().int().min(1).max(30).optional() }),
  level: 0,
  minRole: "viewer",
  reversible: false,
  run: async ({ kind, limit }) => {
    const r = await openDecisions(kind ?? "all", limit ?? 10);
    return { counts: r.counts, items: r.items.map((d) => ({ id: d.id, kind: d.kind, label: d.label, title: d.title, description: d.description, since: d.createdAt, link: d.href })) };
  },
});

const recentActions = define({
  name: "recent_actions",
  description: "What happened recently, for one company (accountId) or the whole client: Vega actions (what, why, status) and pipeline steps (research, scoring, drafting) with their outcome. Use for 'what changed', 'what did you do', 'what failed'.",
  input: z.object({ accountId: z.string().min(5).max(40).optional(), hours: z.number().int().min(1).max(24 * 30).optional() }),
  level: 0,
  minRole: "viewer",
  reversible: false,
  target: ({ accountId }) => ({ accountId }),
  run: async ({ accountId, hours }) => {
    const since = new Date(Date.now() - (hours ?? 24) * 3_600_000);
    const where = { createdAt: { gte: since }, ...(accountId ? { accountId } : {}) };
    const [actions, steps] = await Promise.all([
      db.agentAction.findMany({ where: { ...where, level: { gt: 0 } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, tool: true, level: true, status: true, reason: true, accountId: true, createdAt: true, error: true } }),
      db.pipelineEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 40, select: { step: true, outcome: true, reason: true, accountId: true, createdAt: true, account: { select: { name: true } } } }),
    ]);
    return { since, actions, steps: steps.map((s) => ({ step: s.step, outcome: s.outcome, reason: s.reason, company: s.account?.name ?? null, accountId: s.accountId, at: s.createdAt })) };
  },
});

const recommendedApprovalsTool = define({
  name: "recommended_approvals",
  description: "Emails waiting for approval, each with Vega's strength (strong / fair / weak), recommendation (approve / edit / reject) and reasons, strongest first. Use for 'show me the strongest drafts', 'what should I approve'. You cannot approve; the person approves with the buttons shown next to the conversation.",
  input: z.object({ limit: z.number().int().min(1).max(30).optional() }),
  level: 0,
  minRole: "viewer",
  reversible: false,
  run: async ({ limit }) => {
    const { recommendedApprovals } = await import("./approvals");
    const items = await recommendedApprovals(limit ?? 10);
    return { counts: { strong: items.filter((i) => i.strength === "strong").length, fair: items.filter((i) => i.strength === "fair").length, weak: items.filter((i) => i.strength === "weak").length }, items: items.map((i) => ({ draftId: i.draftId, person: i.person, company: i.company, accountId: i.accountId, subject: i.subject, strength: i.strength, recommendation: i.recommendation, reasons: i.reasons, waitingDays: i.waitingDays, link: i.reviewId ? `/review?type=draft_approval&pick=${i.reviewId}` : "/review?type=draft_approval" })) };
  },
});

/** Lookups over platform-wide tables (no client column): full Super Admins only. */
export const PLATFORM_ONLY = new Set(["errors", "audit_log", "jobs"]);

/** The assistant's existing lookups, unchanged, as level-0 tools. */
const lookups: AgentTool[] = Object.entries(LOOKUPS).map(([name, t]) => ({
  platformOnly: PLATFORM_ONLY.has(name),
  name,
  description: t.description,
  input: t.args,
  level: 0,
  minRole: "viewer",
  reversible: false,
  run: async (input) => redact(await t.run(input as never)),
}));

export const REGISTRY: Record<string, AgentTool> = Object.fromEntries([accountOverview, openApprovals, recentActions, recommendedApprovalsTool, ...lookups, ...LEVEL1, ...LEVEL2, ...LEVEL3].map((t) => [t.name, t]));

/** What chat may propose (a person confirms each one). Event reactions (level 2) are never proposed. */
export const CHAT_PROPOSABLE = new Set(["refresh_research", "rescore", "prepare_drafts", "follow_up_task", "find_people", "approve_drafts"]);

export function catalog(maxLevel: number, opts: { proposals?: boolean; platform?: boolean } = {}): string {
  return Object.values(REGISTRY)
    .filter((t) => t.level <= maxLevel || (opts.proposals && CHAT_PROPOSABLE.has(t.name)))
    .filter((t) => !t.platformOnly || opts.platform)
    .map((t) => {
      const shape = (t.input as z.ZodObject<z.ZodRawShape>).shape as Record<string, z.ZodTypeAny> | undefined;
      const args = shape ? `{ ${Object.entries(shape).map(([k, v]) => `${k}${v.isOptional() ? "?" : ""}`).join(", ")} }` : "{}";
      return `- ${t.name}${t.level > 0 ? " (PROPOSAL: the person must confirm it)" : ""}: ${t.description} Args (JSON): ${args}`;
    })
    .join("\n");
}
