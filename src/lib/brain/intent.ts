// Intent engine: catches buying intent from many independent signal families and
// scores how strongly they CONVERGE. One noisy signal is never enough; three
// independent families pointing the same way is. Every signal keeps its evidence,
// so the "why now" in a brief or email is built from real, specific signals —
// never a generic line.

import type { Evidence, JourneyStage, Signal } from "@prisma/client";
import { db } from "@/lib/db";
import { seller } from "@/lib/seller";
import { classifyTrigger } from "@/lib/seller/fit";
import { isTriggerKey } from "@/lib/research/keys";
import { STAGE_INFO } from "@/lib/journey/stages";

const DAY = 86_400_000;

/** Signal families. Signals in the same family corroborate; different families converge. */
export type IntentFamily =
  | "trigger" // a market event: migration, expansion, funding, compliance mandate…
  | "programme" // an active programme in the seller's space (deep dive)
  | "leadership" // a new decision maker
  | "hiring" // hiring in the owning function
  | "conversation" // a person engaged on LinkedIn
  | "engagement" // email opens/clicks/replies, site and pricing visits
  | "third_party" // intent provider surge
  | "team_context" // the client's own notes and keywords from the import
  | "negative"; // layoffs, freeze, acquisition — subtracts

export interface IntentSignal {
  family: IntentFamily;
  /** Short, specific label: what happened, at whom, when. */
  label: string;
  /** 0–1 after status and recency decay. Negative for negative signals. */
  strength: number;
  at: Date | null;
  /** Evidence / journey / signal ids it rests on. */
  refs: string[];
  /** Which pack trigger it matches, if any. */
  trigger?: string | null;
  contactId?: string | null;
}

export interface IntentReading {
  score: number; // 0–100
  level: "hot" | "warm" | "cold";
  /** Distinct positive families (convergence). */
  families: IntentFamily[];
  signals: IntentSignal[];
  /** The 2–3 strongest converging signals, as a specific "why now". Null when nothing converges. */
  whyNow: string | null;
  /** Why the score is what it is, for reviewers. */
  explain: string;
}

/** Half-life in days per family: market events fade slowly, clicks fast. */
const HALF_LIFE: Record<IntentFamily, number> = { trigger: 60, programme: 120, leadership: 120, hiring: 45, conversation: 21, engagement: 14, third_party: 21, team_context: 90, negative: 90 };
/** How much one family can contribute at full strength (points out of 100). */
const WEIGHT: Record<IntentFamily, number> = { trigger: 26, programme: 24, leadership: 16, hiring: 14, conversation: 28, engagement: 14, third_party: 10, team_context: 8, negative: -40 };

const decay = (family: IntentFamily, at: Date | null, now: Date) => (at ? Math.pow(0.5, Math.max(0, now.getTime() - at.getTime()) / DAY / HALF_LIFE[family]) : 0.7);
const statusWeight = (s: string) => (s === "verified" ? 1 : s === "probable" ? 0.65 : s === "stale" ? 0.25 : 0);

const ENGAGED: Partial<Record<JourneyStage, number>> = { replied_neutral: 0.45, details_requested: 0.8, details_shared: 0.75, interested: 1, call_scheduled: 1, demo_scheduled: 1, opportunity: 1, nurture: 0.3, referred: 0.35, connection_accepted: 0.15, follow_up_sent: 0.05 };
const SIGNAL_STRENGTH: Partial<Record<Signal["type"], number>> = { email_reply: 1, pricing_visit: 0.9, event_attended: 0.8, content_download: 0.6, site_visit: 0.4, email_click: 0.35, email_open: 0.05, intent_surge: 0.7, job_change: 0.3 };

function familyOf(e: Pick<Evidence, "key">): IntentFamily | null {
  if (e.key === "erp_program") return "programme";
  if (e.key === "leadership") return "leadership";
  if (e.key === "owner_function") return "hiring";
  if (isTriggerKey(e.key)) return "trigger";
  return null;
}

/** Pure scoring: signals in, reading out. Convergence of independent families is what makes intent "hot". */
export function scoreIntent(signals: IntentSignal[]): IntentReading {
  const byFamily = new Map<IntentFamily, IntentSignal[]>();
  for (const s of signals) byFamily.set(s.family, [...(byFamily.get(s.family) ?? []), s]);
  let raw = 0;
  const positive: IntentFamily[] = [];
  for (const [fam, list] of byFamily) {
    const sorted = [...list].sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
    // Same-family signals corroborate with diminishing returns: 1 + ½ + ¼ …, capped at 1.
    const combined = Math.min(1, sorted.reduce((t, s, i) => t + Math.abs(s.strength) / Math.pow(2, i), 0));
    raw += WEIGHT[fam] * combined;
    if (fam !== "negative" && combined >= 0.15) positive.push(fam);
  }
  // Convergence: independent families agreeing is worth more than any one loud signal.
  const conv = positive.filter((f) => f !== "team_context").length;
  const bonus = conv >= 4 ? 20 : conv === 3 ? 12 : conv === 2 ? 5 : 0;
  const cap = conv <= 1 ? 45 : 100; // one family alone can never be "hot"
  const score = Math.max(0, Math.min(cap, Math.round(raw + bonus)));
  const level = score >= 65 && conv >= 2 ? "hot" : score >= 35 ? "warm" : "cold";
  const top = signals.filter((s) => s.strength > 0 && s.family !== "team_context").sort((a, b) => b.strength * WEIGHT[b.family] - a.strength * WEIGHT[a.family]);
  const picked: IntentSignal[] = [];
  for (const s of top) if (!picked.some((p) => p.family === s.family) && picked.length < 3) picked.push(s);
  const whyNow = picked.length >= 2 ? picked.map((s) => s.label).join("; and ") : picked.length === 1 && picked[0].strength >= 0.6 ? picked[0].label : null;
  const neg = byFamily.get("negative");
  const explain = `${conv} independent signal famil${conv === 1 ? "y" : "ies"} (${positive.join(", ") || "none"})${bonus ? `, +${bonus} for convergence` : ""}${cap < 100 ? ", capped at 45: one family alone is not enough" : ""}${neg ? `, ${neg.length} negative signal(s) subtracted` : ""}`;
  return { score, level, families: positive, signals: [...signals].sort((a, b) => b.strength - a.strength), whyNow, explain };
}

/** Collect every signal the system holds for an account (or one person in it). */
export async function collectSignals(accountId: string, now = new Date(), contactId?: string): Promise<IntentSignal[]> {
  const sp = seller();
  const [account, evidence, journeys, signals] = await Promise.all([
    db.account.findUniqueOrThrow({ where: { id: accountId }, select: { name: true, keywords: true, companyNotes: true, intentScore: true } }),
    db.evidence.findMany({ where: { accountId, supersededById: null, flagged: false, status: { in: ["verified", "probable", "stale"] } } }),
    db.journey.findMany({ where: { contact: { accountId, mergedIntoId: null, ...(contactId ? { id: contactId } : {}) } }, include: { contact: { select: { id: true, fullName: true, titleNormalized: true, title: true } }, sender: { select: { name: true } } } }),
    db.signal.findMany({ where: { accountId, occurredAt: { gte: new Date(now.getTime() - 120 * DAY) }, ...(contactId ? { OR: [{ contactId }, { contactId: null }] } : {}) } }),
  ]);
  const out: IntentSignal[] = [];
  const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const when = (d: Date | null) => (d ? ` (${d.toISOString().slice(0, 10)})` : "");

  // 1. Research: triggers, programmes, leadership, hiring — corroborated facts count more.
  const groups = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (e.isNegative) continue;
    const fam = familyOf(e);
    if (!fam) continue;
    const k = `${fam}|${(e.value ?? e.claim).toLowerCase().slice(0, 60)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const [k, list] of groups) {
    const fam = k.split("|")[0] as IntentFamily;
    const best = list.sort((a, b) => statusWeight(b.status) - statusWeight(a.status) || b.publishedAt.getTime() - a.publishedAt.getTime())[0];
    const sources = new Set(list.map((e) => e.sourceUrl)).size;
    const corroboration = Math.min(1, 0.75 + 0.25 * (sources - 1));
    const strength = statusWeight(best.status) * decay(fam, best.publishedAt, now) * corroboration;
    if (strength < 0.05) continue;
    const trig = classifyTrigger(best.claim, sp);
    out.push({ family: fam, label: `${short(best.claim)}${when(best.publishedAt)}${sources > 1 ? `, ${sources} sources` : ""}`, strength, at: best.publishedAt, refs: list.map((e) => e.id), trigger: trig?.key ?? null });
  }

  // 2. Negatives subtract.
  for (const e of evidence.filter((x) => x.isNegative)) {
    const strength = statusWeight(e.status) * decay("negative", e.publishedAt, now);
    if (strength >= 0.05) out.push({ family: "negative", label: `${short(e.claim)}${when(e.publishedAt)}`, strength: -strength, at: e.publishedAt, refs: [e.id] });
  }

  // 3. People already talking to us on LinkedIn — the strongest first-party signal.
  for (const j of journeys) {
    const base = ENGAGED[j.stage];
    if (!base) continue;
    const strength = base * decay("conversation", j.lastEngagementAt, now);
    if (strength < 0.05) continue;
    out.push({ family: "conversation", label: `${j.contact.fullName}${j.contact.titleNormalized ?? j.contact.title ? ` (${j.contact.titleNormalized ?? j.contact.title})` : ""} is ${STAGE_INFO[j.stage].label.toLowerCase()} on LinkedIn with ${j.sender.name}${when(j.lastEngagementAt)}`, strength, at: j.lastEngagementAt, refs: [j.id], contactId: j.contact.id });
  }

  // 4. Email and web engagement, third-party surges.
  const eng = new Map<string, { n: number; best: Signal; s: number }>();
  for (const s of signals) {
    const fam: IntentFamily = s.type === "intent_surge" ? "third_party" : "engagement";
    const strength = (SIGNAL_STRENGTH[s.type] ?? 0.2) * decay(fam, s.occurredAt, now);
    const k = `${fam}|${s.type}`;
    const cur = eng.get(k);
    if (!cur || strength > cur.s) eng.set(k, { n: (cur?.n ?? 0) + 1, best: s, s: strength });
    else cur.n++;
  }
  for (const [k, v] of eng) {
    if (v.s < 0.05) continue;
    const fam = k.split("|")[0] as IntentFamily;
    out.push({ family: fam, label: `${v.n}× ${v.best.type.replace(/_/g, " ")}${v.best.detail ? ` — ${short(v.best.detail, 60)}` : ""}${when(v.best.occurredAt)}`, strength: v.s, at: v.best.occurredAt, refs: [v.best.id], contactId: v.best.contactId });
  }

  // 5. What the client's own team knows (import keywords and notes that match a buying trigger).
  const ctxText = [account.keywords.join("; "), account.companyNotes ?? ""].join(" ");
  const t = ctxText.trim() ? classifyTrigger(ctxText, sp) : null;
  if (t) out.push({ family: "team_context", label: `Your team's notes point to ${t.label.toLowerCase()}`, strength: 0.6, at: null, refs: [], trigger: t.key });

  return out;
}

/** Read intent for an account (or a person in it) and store the account reading. */
export async function readIntent(accountId: string, now = new Date(), contactId?: string): Promise<IntentReading> {
  const reading = scoreIntent(await collectSignals(accountId, now, contactId));
  if (!contactId) {
    await db.account.update({ where: { id: accountId }, data: { intentReading: reading as unknown as object } });
  }
  return reading;
}

/** The part of a reading the strategist and writer need. */
export function toIntentContext(r: IntentReading) {
  return { score: r.score, level: r.level, whyNow: r.whyNow, signals: r.signals.filter((s) => s.strength > 0).slice(0, 6).map((s) => ({ family: s.family, label: s.label })) };
}
