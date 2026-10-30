// Opportunity rules shared by the CRM board: how likely each open stage is to close
// (for the weighted forecast), and what on a deal needs a person.

import type { OppStage } from "@prisma/client";

/** How likely a deal at each open stage is to close, for the weighted forecast. */
export const LIKELIHOOD: Partial<Record<OppStage, number>> = { discovery: 0.1, qualification: 0.25, proposal: 0.5, negotiation: 0.75 };
export const STALE_DAYS = 21;

/** What on an open deal needs a person: a passed close date, none set, no owner, or no change in weeks. */
export function attention(o: { stage: OppStage; closeDate: Date | null; ownerId: string | null; updatedAt: Date }, now: Date): string | null {
  if (o.stage === "won" || o.stage === "lost") return null;
  if (o.closeDate && o.closeDate < now) return `Close date passed (${o.closeDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`;
  if (!o.closeDate) return "No close date set";
  if (!o.ownerId) return "No owner";
  if (now.getTime() - o.updatedAt.getTime() > STALE_DAYS * 86_400_000) return `No change in ${Math.floor((now.getTime() - o.updatedAt.getTime()) / 86_400_000)} days`;
  return null;
}

