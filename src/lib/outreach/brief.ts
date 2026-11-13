// The brief behind every email: why this person, why now, why us, and one ask. Built by code
// from the research and the Account Brain before anything is written, given to the writer as the
// spine of the email, saved with the draft and shown to the person who approves it.

import { isTriggerKey } from "@/lib/research/keys";
import type { SellerProfile } from "@/lib/seller/types";
import type { WritingContext } from "@/lib/knowledge/select";

export interface BriefFact {
  id: string;
  key: string;
  claim: string;
  status: string;
  publishedAt: Date;
  eventDate?: Date | null;
  confidence?: number | null;
  quote?: string | null;
  sourceUrl?: string | null;
  publisher?: string | null;
}

export interface DraftBrief {
  whyPerson: { name: string | null; title: string | null; role: string; cares: string[] };
  whyNow: { factId: string; claim: string; quote: string | null; url: string | null; publisher: string | null; date: string; confidence: number | null; verified: boolean };
  /** At most two more facts the email may use. */
  support: { factId: string; claim: string }[];
  whyUs: { useCase: string | null; pain: string | null; capability: string | null; proofPoint: string | null; pitch: string };
  ask: string;
  never: string[];
}

const ROLE_WORD: Record<string, string> = { decision_maker: "Decision maker", champion: "Champion", influencer: "Influencer", budget_owner: "Budget owner", unknown: "Contact" };

/**
 * The strongest fresh buying trigger: most confident first, then the most recent event, then
 * verified before probable. Facts without a confidence yet count as 50.
 */
export function pickLeadTrigger<F extends BriefFact>(facts: F[]): F | null {
  const triggers = facts.filter((f) => isTriggerKey(f.key) && (f.status === "verified" || f.status === "probable"));
  if (!triggers.length) return null;
  const when = (f: F) => (f.eventDate ?? f.publishedAt).getTime();
  return [...triggers].sort((a, b) => (b.confidence ?? 50) - (a.confidence ?? 50) || when(b) - when(a) || (a.status === "verified" ? -1 : 1) - (b.status === "verified" ? -1 : 1))[0];
}

export function buildDraftBrief(i: {
  contact: { firstName: string | null; title: string | null; buyingRole: string };
  facts: BriefFact[];
  sp: SellerProfile;
  writing: WritingContext | null;
  useCase: string | null;
  angle: { pain: string; capability: string } | null;
  proofPoint: string | null;
  pitch: string;
}): DraftBrief | null {
  const lead = pickLeadTrigger(i.facts);
  if (!lead) return null;
  const support = i.facts.filter((f) => f.id !== lead.id && (f.status === "verified" || f.status === "probable")).slice(0, 2);
  const uc = i.useCase ? i.sp.useCases.find((u) => u.key === i.useCase) : undefined;
  return {
    whyPerson: {
      name: i.contact.firstName,
      title: i.contact.title,
      role: ROLE_WORD[i.contact.buyingRole] ?? "Contact",
      cares: i.writing?.persona?.cares.slice(0, 3) ?? [],
    },
    whyNow: {
      factId: lead.id, claim: lead.claim, quote: lead.quote ?? null, url: lead.sourceUrl ?? null, publisher: lead.publisher ?? null,
      date: (lead.eventDate ?? lead.publishedAt).toISOString().slice(0, 10), confidence: lead.confidence ?? null, verified: lead.status === "verified",
    },
    support: support.map((f) => ({ factId: f.id, claim: f.claim })),
    whyUs: {
      useCase: uc?.name ?? i.useCase,
      pain: i.angle?.pain ?? uc?.pains ?? null,
      capability: i.angle?.capability ?? uc?.outcome ?? null,
      proofPoint: i.proofPoint,
      pitch: i.pitch,
    },
    ask: i.writing?.play.cta || i.sp.messaging.cta || "One soft question about whether this is a priority",
    never: [
      ...i.sp.bannedClaims,
      "Anything about them that isn't in the facts listed here",
      "A guess stated as a fact (ask it as a question instead)",
      "That they visited our website or read a page",
    ],
  };
}

/**
 * Sentences about the seller are not claims about the prospect. The writer sometimes lists one
 * ("<Seller> verifies PAN and GSTIN in real time") without a fact id; that is the seller's own pitch,
 * checked by the banned-claim and compliance rules, not a missing fact.
 */
export function isSellerSentence(text: string, sellerNames: string | string[], pitchTexts: string[]): boolean {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  // The brand: each name in full, and its first word ("Acme" of "Acme Technologies").
  const brands = (Array.isArray(sellerNames) ? sellerNames : [sellerNames])
    .map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .flatMap((n) => [n, n.split(" ")[0]])
    .filter((n) => n.length >= 3);
  if (brands.some((b) => t.includes(` ${b} `))) return true;
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const w = words(text);
  if (!w.size) return false;
  return pitchTexts.some((p) => {
    const pw = words(p);
    let shared = 0;
    for (const x of w) if (pw.has(x)) shared++;
    return shared / w.size >= 0.6;
  });
}

/** Turn a failed check into an instruction the writer can act on. */
export function fixInstruction(issue: string, allowed: { id: string; claim: string }[]): string {
  const ids = allowed.slice(0, 6).map((f) => f.id).join(", ");
  if (/without a cited fact|cites unknown fact|cites a (stale|unknown|invalid|conflicting)/i.test(issue)) return `${issue}. Fix: cite one of these fact ids (${ids}) for that sentence, or remove it.`;
  if (/not supported by its source|Unsupported statement/i.test(issue)) return `${issue}. Fix: say only what the cited fact says, or remove the sentence.`;
  if (/guess as fact/i.test(issue)) return `${issue}. Fix: ask it as a question.`;
  return issue;
}
