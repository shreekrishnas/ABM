// Picks the writing knowledge for one message: the play for the step, the persona
// profile that fits the recipient, the closest examples, and the market norms and facts.
// Plain tag matching, no embeddings: with a few hundred items, exact matches on persona,
// play, use case and trigger are more predictable and easy to explain ("why this example").

import type { PersonaProfile, WritingExample, WritingKnowledge } from "@/lib/seller/types";
import { PLAYS, playBrief, type Play, type PlayKey } from "./playbook";

export interface Recipient {
  buyingRole: string | null;
  function: string | null;
  title: string | null;
}

/** Best persona profile for a person: title words first, then function, then buying role. */
export function pickPersona(personas: PersonaProfile[], r: Recipient): PersonaProfile | null {
  const title = (r.title ?? "").toLowerCase();
  let best: { p: PersonaProfile; score: number } | null = null;
  for (const p of personas) {
    let score = 0;
    if (title && p.titleHints.some((h) => new RegExp(`(^|[^a-z])${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(title))) score += 3;
    if (r.function && p.functions.includes(r.function)) score += 2;
    if (r.buyingRole && p.role === r.buyingRole) score += 1;
    if (score > (best?.score ?? 0)) best = { p, score };
  }
  return best && best.score >= 2 ? best.p : null;
}

/** Closest examples for this play: same play required; persona, use case and trigger break ties. */
export function pickExamples(examples: WritingExample[], q: { play: PlayKey; persona: string | null; useCase: string | null; trigger: string | null }, take = { good: 2, bad: 1 }): WritingExample[] {
  const score = (e: WritingExample) => (e.persona === q.persona ? 4 : 0) + (q.useCase && e.useCase === q.useCase ? 2 : 0) + (q.trigger && e.trigger === q.trigger ? 1 : 0);
  const same = examples.filter((e) => e.play === q.play);
  const rank = (quality: "good" | "bad") => same.filter((e) => e.quality === quality).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  return [...rank("good").slice(0, take.good), ...rank("bad").slice(0, take.bad)];
}

export interface WritingContext {
  play: Play;
  playBrief: string;
  persona: { key: string; name: string; cares: string[]; language: string[]; avoid: string[]; opener: string } | null;
  examples: { id: string; quality: "good" | "bad"; subject?: string; body: string; why: string }[];
  norms: string[];
  marketFacts: { id: string; text: string; attribution: string }[];
  /** Retrieved from the knowledge base for this message (RAG). Approved = may be stated about the seller. */
  references?: { chunkId: string; title: string; kind: string; approved: boolean; text: string }[];
}

/** Everything the writer gets for one message. Works without seller writing knowledge (play only). */
export function writingContext(w: WritingKnowledge | undefined, q: { play: PlayKey; recipient: Recipient; useCase: string | null; trigger: string | null }): WritingContext {
  const play = PLAYS[q.play];
  const persona = w ? pickPersona(w.personas, q.recipient) : null;
  const examples = w ? pickExamples(w.examples, { play: q.play, persona: persona?.key ?? null, useCase: q.useCase, trigger: q.trigger }) : [];
  // Market facts are for follow-ups and later messages: the first touch leads with the prospect's own trigger.
  const marketFacts = w && q.play !== "email_first" && q.play !== "linkedin_connect" ? w.marketFacts.map(({ id, text, attribution }) => ({ id, text, attribution })) : [];
  return {
    play,
    playBrief: playBrief(play),
    persona: persona ? { key: persona.key, name: persona.name, cares: persona.cares, language: persona.language, avoid: persona.avoid, opener: persona.opener } : null,
    examples: examples.map(({ id, quality, subject, body, why }) => ({ id, quality, subject, body, why })),
    norms: w?.market.norms.map((n) => n.text) ?? [],
    marketFacts,
  };
}

/** What a draft records about the knowledge it used, so results can be traced back to it. */
export function knowledgeTrace(c: WritingContext) {
  return { play: c.play.key, persona: c.persona?.key ?? null, examples: c.examples.map((e) => e.id), marketFacts: c.marketFacts.map((f) => f.id), references: (c.references ?? []).map((r) => r.chunkId) };
}
