// Every judgement shows both sides: the choice, the case for and against, the
// evidence for each, and a confidence. Reviewers see why the brain chose, not only what.

import { db } from "@/lib/db";
import { sellerContext } from "@/lib/seller";
import type { RunContext } from "@/lib/pipeline/context";

export interface DecisionInput {
  module: string;
  question: string;
  choice: string;
  caseFor: string;
  caseAgainst: string;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  confidence: number;
  /** acted = the brain did it; needs_human = it stopped at a fence and asked a person. */
  autonomy: "acted" | "needs_human";
  accountId?: string | null;
  contactId?: string | null;
  draftId?: string | null;
}

export async function decide(ctx: RunContext, d: DecisionInput) {
  const { pack, version } = sellerContext();
  return db.decision.create({
    data: {
      runId: ctx.runId, accountId: d.accountId ?? null, contactId: d.contactId ?? null, draftId: d.draftId ?? null,
      module: d.module, question: d.question.slice(0, 300), choice: d.choice.slice(0, 300),
      caseFor: d.caseFor.slice(0, 600) || "—", caseAgainst: d.caseAgainst.slice(0, 600) || "—",
      evidenceFor: (d.evidenceFor ?? []).slice(0, 10), evidenceAgainst: (d.evidenceAgainst ?? []).slice(0, 10),
      confidence: Math.max(0, Math.min(1, Number(d.confidence.toFixed(2)))), autonomy: d.autonomy,
      sellerId: pack.id, packVersion: version, createdAt: ctx.now,
    },
  });
}
