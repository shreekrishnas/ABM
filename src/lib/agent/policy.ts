// The one gate every Vega action passes, whatever started it. Later levels add checks here,
// never around it.
import { atLeast } from "@/lib/roles";
import type { AgentContext, AgentTool } from "./types";
import { SYSTEM_ACTOR } from "./types";

export type Verdict = { ok: true } | { ok: false; code: "not_allowed_user" | "other_client" | "platform_only" | "level" | "ai_paused" | "budget" | "suppressed" | "role"; reason: string };

export interface PolicyDeps {
  aiPaused: () => Promise<boolean>;
  budgetOk: (sellerId: string, usd: number) => Promise<boolean>;
  suppressed?: (input: unknown) => Promise<boolean>;
}

/** Step 1 rule: only Super Admins who cover the client use Vega; background work is the system's own. */
export async function authorize(tool: AgentTool, input: unknown, ctx: AgentContext, deps: PolicyDeps): Promise<Verdict> {
  if (ctx.actor !== SYSTEM_ACTOR) {
    const me = ctx.me;
    if (!me?.superAdmin) return { ok: false, code: "not_allowed_user", reason: "Vega is not available for your account." };
    if (me.superAdminClients !== null && !me.superAdminClients.includes(ctx.sellerId)) return { ok: false, code: "other_client", reason: "That client isn't one you cover." };
    if (tool.platformOnly && me.superAdminClients !== null) return { ok: false, code: "platform_only", reason: "Platform-wide records (errors, audit log, jobs) are for Super Admins covering every client." };
  }
  if (tool.level > ctx.maxLevel) return { ok: false, code: "level", reason: tool.level === 0 ? "Not allowed here." : "I can only look things up for now; this would change data, so it isn't switched on yet." };
  if (tool.minRole !== "viewer" && ctx.actor !== SYSTEM_ACTOR && !ctx.me?.superAdmin) {
    const role = ctx.me?.clients.find((c) => c.id === ctx.sellerId)?.role;
    if (!role || !atLeast(role, tool.minRole)) return { ok: false, code: "role", reason: `Needs the ${tool.minRole} role.` };
  }
  const cost = tool.estimateCostUsd?.(input as never) ?? 0;
  if (cost > 0 && (await deps.aiPaused())) return { ok: false, code: "ai_paused", reason: "AI work is paused for the workspace." };
  if (cost > 0 && !(await deps.budgetOk(ctx.sellerId, cost))) return { ok: false, code: "budget", reason: "This would go over the client's monthly budget." };
  if (tool.contactsPeople && deps.suppressed && (await deps.suppressed(input))) return { ok: false, code: "suppressed", reason: "This person or company has opted out or is marked do-not-contact." };
  return { ok: true };
}
