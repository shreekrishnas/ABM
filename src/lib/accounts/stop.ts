// Why a company stopped, and the one step that moves it on. Used on the company page (a banner with
// the step) and the Companies list (marked, with a "Stopped" filter), so a stopped company is never a
// dead end: in production 4 of 11 companies were stopped, two with no reason or step shown anywhere.

import { db } from "@/lib/db";

export const STOPPED_STATUSES = ["blocked", "error"];

export type NextStep =
  | { kind: "decide"; label: string; href: string }
  | { kind: "people"; label: string; href: string }
  | { kind: "research"; label: string }
  | { kind: "run"; label: string };

/** The step for a stop reason; an open decision for the company comes first. */
export function nextStep(accountId: string, reason: string, review?: { id: string; type: string } | null): NextStep {
  if (review) return { kind: "decide", label: "Decide in Approvals", href: `/review?type=${encodeURIComponent(review.type)}&pick=${encodeURIComponent(review.id)}` };
  if (/no ready contacts|no usable person|no (one|person) to (contact|email)/i.test(reason)) return { kind: "people", label: "See who was found", href: `/accounts/${encodeURIComponent(accountId)}?tab=people` };
  if (/research incomplete|round limit|not asked|more research/i.test(reason)) return { kind: "research", label: "Research again" };
  return { kind: "run", label: "Run again" };
}

/** The latest stop reason for each company (its last blocked or failed step, else its last error). */
export async function stopReasons(accounts: { id: string; lastError?: string | null }[]): Promise<Map<string, string>> {
  if (!accounts.length) return new Map();
  const rows = await db.pipelineEvent.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) }, outcome: { in: ["block", "error"] } },
    orderBy: { createdAt: "desc" }, distinct: ["accountId"], select: { accountId: true, reason: true },
  });
  const out = new Map(rows.filter((r) => r.accountId && r.reason).map((r) => [r.accountId!, r.reason!]));
  for (const a of accounts) if (!out.has(a.id) && a.lastError) out.set(a.id, a.lastError);
  for (const a of accounts) if (!out.has(a.id)) out.set(a.id, "Stopped without a recorded reason");
  return out;
}
