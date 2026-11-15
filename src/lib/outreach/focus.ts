// What a company's signals are about. Research facts, hiring, engagement and the topics they
// read on our website each point at one of the seller's use cases; when several point at the
// same one, that is what the email pitches, with the matching proof from the knowledge base.

import { classifyTrigger } from "@/lib/seller/fit";
import type { SellerProfile } from "@/lib/seller/types";

export interface FocusEvidence {
  /** Where it came from: a research fact, a buying signal, or interest shown on our website. */
  source: "fact" | "signal" | "website";
  text: string;
}

export interface SignalFocus {
  useCase: string;
  name: string;
  /** How many separate pieces of evidence point here. */
  votes: number;
  /** Two or more separate pieces point here: the email is built around it. */
  strong: boolean;
  /** The kinds of source that agree (research, signals, website). */
  sources: FocusEvidence["source"][];
  why: string[];
}

const STOP = new Set(["and", "the", "for", "with", "from", "data", "team", "teams", "into", "their", "your", "our", "new", "real", "time", "first", "right", "management"]);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9/]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/** The use case one piece of evidence points at: the seller's trigger keywords first, then the use case's own words. */
function pointsAt(text: string, sp: SellerProfile): string | null {
  const tr = classifyTrigger(text, sp);
  if (tr?.useCase && sp.useCases.some((u) => u.key === tr.useCase)) return tr.useCase;
  const w = words(text);
  let best: { key: string; hits: number } | null = null;
  for (const u of sp.useCases) {
    const own = words(`${u.name} ${u.key.replace(/_/g, " ")}`);
    const hits = [...own].filter((x) => w.has(x)).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { key: u.key, hits };
  }
  return best?.key ?? null;
}

/**
 * The use case the company's evidence converges on, or null when nothing points anywhere.
 * Ties go to the use case with evidence from more kinds of source, then to the earlier evidence
 * (callers pass the strongest first).
 */
export function signalFocus(evidence: FocusEvidence[], sp: SellerProfile): SignalFocus | null {
  const by = new Map<string, { votes: number; sources: Set<string>; why: string[]; first: number }>();
  evidence.forEach((e, i) => {
    const key = pointsAt(e.text, sp);
    if (!key) return;
    const b = by.get(key) ?? { votes: 0, sources: new Set<string>(), why: [], first: i };
    b.votes++;
    b.sources.add(e.source);
    if (b.why.length < 4) b.why.push(`${e.source === "fact" ? "Research" : e.source === "signal" ? "Signal" : "Website interest"}: ${e.text.slice(0, 160)}`);
    by.set(key, b);
  });
  const ranked = [...by.entries()].sort(([, a], [, b]) => b.votes - a.votes || b.sources.size - a.sources.size || a.first - b.first);
  if (!ranked.length) return null;
  const [key, b] = ranked[0];
  const uc = sp.useCases.find((u) => u.key === key)!;
  return { useCase: key, name: uc.name, votes: b.votes, strong: b.votes >= 2, sources: [...b.sources] as FocusEvidence["source"][], why: b.why };
}
