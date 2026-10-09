// RAG for one outgoing message: what the knowledge base adds on top of the tag-picked
// play, persona and examples. Two lookups:
//   1. reference knowledge — case studies, product and use-case notes, persona and
//      market notes, competitor positioning and uploaded documents that fit this person,
//      trigger and use case;
//   2. extra examples — uploaded or learned messages (ones that got positive replies)
//      for the same play, which beat the built-in starter examples once they exist.
// Never blocks a draft: if the embedding service is down, the message is written without.

import type { SellerProfile } from "@/lib/seller/types";
import type { WritingContext } from "../select";
import { ensureIndexed } from "./store";
import { retrieve, type Hit } from "./retrieve";

const REFERENCE_KINDS = ["case_study", "product", "persona", "market_fact", "norm", "competitor", "document", "objection"];

export interface MessageQuery {
  sp: SellerProfile;
  writing: WritingContext;
  recipientTitle: string | null;
  company: string;
  trigger: { key: string; label: string } | null;
  useCase: string | null;
  leadFact: string | null;
}

export function queryText(q: MessageQuery) {
  const uc = q.useCase ? q.sp.useCases.find((u) => u.key === q.useCase) : null;
  return [
    q.writing.play.label,
    q.writing.persona?.name ?? q.recipientTitle ?? "",
    q.recipientTitle ?? "",
    q.trigger?.label ?? "",
    uc ? `${uc.name}: ${uc.pains}` : "",
    q.leadFact ?? "",
  ].filter(Boolean).join(". ");
}

export async function retrieveForMessage(q: MessageQuery): Promise<{ references: NonNullable<WritingContext["references"]>; examples: Hit[]; error?: string }> {
  try {
    await ensureIndexed(q.sp);
    const prefer = { plays: [q.writing.play.key], personas: q.writing.persona ? [q.writing.persona.key] : undefined, useCases: q.useCase ? [q.useCase] : undefined, triggers: q.trigger ? [q.trigger.key] : undefined };
    const query = queryText(q);
    const [refs, ex] = await Promise.all([
      retrieve({ sellerId: q.sp.id, query, kinds: REFERENCE_KINDS, prefer, channel: q.writing.play.channel, k: 4, minScore: 0.12 }),
      retrieve({ sellerId: q.sp.id, query, kinds: ["example"], prefer, channel: q.writing.play.channel, k: 4, minScore: 0.1 }),
    ]);
    // Only examples a person added or the system learned, for the same play: the built-in ones are already tag-picked.
    const examples = ex.filter((h) => h.origin !== "built_in" && (!h.tags?.plays || h.tags.plays.includes(q.writing.play.key))).slice(0, 2);
    return { references: refs.map((h) => ({ chunkId: h.chunkId, title: h.title, kind: h.kind, approved: h.approved, text: h.text.slice(0, 900) })), examples };
  } catch (e) {
    return { references: [], examples: [], error: e instanceof Error ? e.message : String(e) };
  }
}
