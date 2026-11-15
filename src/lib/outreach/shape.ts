// How an email is built, chosen from what we actually know. Fresh, verified news leads with the
// news; a finance or risk reader leads with the consequence; a strong customer story leads with
// the peer's result; weaker evidence leads with a question; a telling job opening or a deadline
// leads with that. Colleagues at the same company get different shapes, so no two read alike.

export type ShapeKey = "news" | "consequence" | "story" | "question" | "hiring" | "deadline";

export interface EmailShape {
  key: ShapeKey;
  label: string;
  /** Why this shape fits this email (shown to the approver). */
  why: string;
  /** For a hiring-led email: the fact about the job opening. */
  hiringFactId?: string;
}

export interface ShapeInput {
  /** The lead trigger: when it happened, how sure we are. */
  lead: { id: string; claim: string; date: Date; confidence: number | null; verified: boolean };
  /** All usable facts about the company (to spot a job opening or a deadline). */
  facts: { id: string; key: string; claim: string }[];
  role: { buyingRole: string; title: string | null };
  pain: string | null;
  /** An approved customer story or a proof point with a result. */
  proof: string | null;
  /** The seller's trigger the lead matched (a compliance trigger points at a deadline). */
  triggerKey: string | null;
  /** Shapes already used for other people at this company. */
  usedByColleagues: ShapeKey[];
  now: Date;
}

export const SHAPE_LABEL: Record<ShapeKey, string> = {
  news: "Their news first",
  consequence: "The risk for their role first",
  story: "A peer's result first",
  question: "A sharp question first",
  hiring: "Their job opening first",
  deadline: "Their deadline first",
};

/** The order each shape asks the writer to follow. Every shape ends with one ask. */
export const SHAPE_STEPS: Record<ShapeKey, string[]> = {
  news: [
    "Open with WHY NOW in their specifics (programme, number, place, date as the fact states it), citing its fact id.",
    "One sentence on what that usually means for THIS role: one pain, asked as a question.",
    "What we do for it, with ONE concrete proof.",
    "THE ASK, once.",
  ],
  consequence: [
    "Open with the plain consequence someone in THIS role usually faces in a situation like theirs: one sentence, said as what tends to happen ('a single wrong bank account in a vendor master becomes a failed payment'), never as a claim about them. Use a number only if the knowledge base gives it, with its source.",
    "Then tie it to their news, citing its fact id: why it matters now.",
    "What we do for it, with ONE concrete proof.",
    "THE ASK, once, as a question.",
  ],
  story: [
    "Open with a peer's result from an APPROVED customer story or the proof point: the kind of company, what changed, the number. Never name a customer the knowledge base doesn't mark as approved.",
    "Then why it is relevant to them now: their news, citing its fact id.",
    "One question about where they stand on it.",
    "THE ASK, short (it can be the same question).",
  ],
  question: [
    "Open with ONE sharp question that ties their news (cite its fact id) to this role's job, e.g. how they plan to handle X during Y.",
    "One line on what usually goes wrong at that moment (a general pattern, not a claim about them).",
    "What we do for it, with ONE concrete proof.",
    "THE ASK, as a short statement or a second question.",
  ],
  hiring: [
    "Open with the role they are hiring for and what it tells you, citing the job-opening fact.",
    "What that person will likely inherit: one pain, asked as a question.",
    "What we do for it, with ONE concrete proof.",
    "THE ASK, once.",
  ],
  deadline: [
    "Open with the date or rule they face, citing its fact id (or naming the source of an approved market fact).",
    "What that date means for THIS role, in one sentence.",
    "What we do for it, with ONE concrete proof.",
    "THE ASK, once.",
  ],
};

const DAY = 86_400_000;
const HIRING = /\b(is hiring|hiring (a|an|for)|recruit(ing|s)?|job (opening|posting)|open role|vacanc)/i;
const DEADLINE = /\b(deadline|mandat|by (january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|20\d\d)|from (1|01) [a-z]+ 20\d\d|within \d+ days|comes into force|effective from|compliance date|rbi|sebi|dpdp|e-?invoic)/i;
const MONEY_ROLE = /\b(cfo|finance|financial|controller|treasur|risk|compliance|audit|ciso|accounts payable)\b/i;

/** Score each shape from the evidence; the best one that a colleague hasn't already had wins. */
export function chooseShape(i: ShapeInput): EmailShape {
  const ageDays = (i.now.getTime() - i.lead.date.getTime()) / DAY;
  const hiringFact = i.facts.find((f) => HIRING.test(f.claim) || /hiring|jobs|careers/i.test(f.key));
  const deadline = i.triggerKey === "compliance_mandate" || DEADLINE.test(i.lead.claim);
  const moneyRole = i.role.buyingRole === "budget_owner" || MONEY_ROLE.test(i.role.title ?? "");
  const strongProof = Boolean(i.proof && /\d/.test(i.proof));
  const weak = !i.lead.verified || (i.lead.confidence ?? 50) < 60;

  const score: Record<ShapeKey, { s: number; why: string }> = {
    news: { s: 2 + (ageDays <= 21 ? 1 : 0) + (i.lead.verified && (i.lead.confidence ?? 0) >= 75 ? 1 : 0), why: ageDays <= 21 ? "the news is fresh and specific" : "the news is the clearest reason to write" },
    consequence: { s: 1 + (moneyRole ? 3 : 0) + (i.pain ? 1 : 0), why: moneyRole ? "a finance or risk reader cares about the consequence first" : "the pain is concrete" },
    story: { s: (strongProof ? 3 : 0) + (i.role.buyingRole === "champion" || i.role.buyingRole === "influencer" ? 1 : 0), why: "a peer's result with a number is the strongest proof we have" },
    question: { s: 1 + (weak ? 2 : 0) + (i.role.buyingRole === "decision_maker" ? 1 : 0), why: weak ? "the evidence is probable, not verified, so we ask rather than assert" : "a direct question suits a decision maker" },
    hiring: { s: hiringFact ? 5 : -9, why: "their job opening says what they are building" },
    deadline: { s: deadline ? 5 : -9, why: "they have a date or rule to meet" },
  };
  // Colleagues at the same company should not get the same shape.
  for (const u of i.usedByColleagues) score[u].s -= 3;
  const order: ShapeKey[] = ["news", "consequence", "story", "question", "hiring", "deadline"];
  const best = order.reduce((a, b) => (score[b].s > score[a].s ? b : a));
  return { key: best, label: SHAPE_LABEL[best], why: score[best].why, ...(best === "hiring" && hiringFact ? { hiringFactId: hiringFact.id } : {}) };
}
