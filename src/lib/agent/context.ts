// What JARVIS knows before it answers: the company in focus (if any), what waits for people,
// and what happened recently. Built from the same tools a person could call, so the context and
// the answers rest on one set of facts.
import type { AgentContext } from "./types";
import { runAgentTool } from "./execute";

export interface FocusContext { account: unknown | null; approvals: unknown; recent: unknown }

export async function focusContext(ctx: AgentContext, accountId?: string | null): Promise<FocusContext> {
  const reason = "Context for the conversation";
  const [account, approvals, recent] = await Promise.all([
    accountId ? runAgentTool("account_overview", { accountId }, ctx, reason) : Promise.resolve(null),
    runAgentTool("open_approvals", { limit: 5 }, ctx, reason),
    runAgentTool("recent_actions", { accountId: accountId ?? undefined, hours: 24 }, ctx, reason),
  ]);
  return {
    account: account && account.status === "done" ? account.result : null,
    approvals: approvals.status === "done" ? approvals.result : null,
    recent: recent.status === "done" ? recent.result : null,
  };
}
