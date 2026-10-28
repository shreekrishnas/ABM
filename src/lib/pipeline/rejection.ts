// Permanent rejection needs a person. A rule that would rule a company out (targeting, fit,
// relationship, a confirmed blocker) only proposes it: the run pauses with a review item
// holding the evidence, and the company is ruled out when someone approves.

import type { Account, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logEvent, openReview, StopRun, type RunContext } from "./context";

/** Which rule proposed the rejection; a person's "keep" applies to that rule only. */
export type RejectionGate = "relationship" | "targeting" | "fit" | "blocker";

const KEPT = "Kept";
const APPROVED = "Rejection approved";

async function decided(accountId: string, gate: RejectionGate, prefix: string) {
  return db.reviewItem.findFirst({
    where: { accountId, type: "proposed_rejection", status: "resolved", resolution: { startsWith: prefix }, payload: { path: ["gate"], equals: gate } },
    orderBy: { resolvedAt: "desc" },
  });
}

/** A person kept the company against this rule: the rule no longer stops it. */
export async function keptAgainst(accountId: string, gate: RejectionGate): Promise<boolean> {
  return Boolean(await decided(accountId, gate, KEPT));
}

/**
 * Propose ruling the company out. Returns only when a person already kept it against this
 * rule; otherwise the run stops. A rejection already approved for this rule is applied
 * without asking again.
 */
export async function proposeRejection(account: Account, ctx: RunContext, gate: RejectionGate, reason: string, stage: number, payload: Record<string, unknown> = {}): Promise<void> {
  // A kept blocker is handled by setting its reports aside; new bad news must be asked about again.
  if (gate !== "blocker" && (await keptAgainst(account.id, gate))) {
    await logEvent(ctx, { accountId: account.id, stage, step: "rejection.kept", outcome: "pass", reason: `${reason} — kept by a person earlier, carrying on` });
    return;
  }
  if (await decided(account.id, gate, APPROVED)) {
    await db.account.update({ where: { id: account.id }, data: { stage: "DISQUALIFIED", disqualifyReason: reason } });
    await logEvent(ctx, { accountId: account.id, stage, step: "rejection.approved", outcome: "block", reason: `${reason} — rejection already approved by a person` });
    throw new StopRun(reason);
  }
  // Paused, not ruled out: the reason shows on the company; the stage stays until a person decides.
  await db.account.update({ where: { id: account.id }, data: { disqualifyReason: reason } });
  await openReview({ type: "proposed_rejection", stage, accountId: account.id, reason, payload: { gate, ...payload } as Prisma.InputJsonValue });
  await logEvent(ctx, { accountId: account.id, stage, step: "rejection.proposed", outcome: "block", reason: `${reason} — proposed; a person approves before it is ruled out` });
  throw new StopRun(`Rejection proposed: ${reason}`);
}

export const REJECTION_RESOLUTION = { kept: KEPT, approved: APPROVED } as const;
