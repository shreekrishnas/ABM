// LinkedIn messaging performance: does it start real conversations, and how much do people change
// the drafts? Also the "what has worked" notes fed back to the writer (style only: every statement
// still needs a fact, every message still needs a person).

import { db } from "@/lib/db";
import { similarity } from "./rules";
import { KIND_LABEL, type MessageKind, type ReplyAnalysis } from "./types";

const DAY = 86_400_000;
const REPLY_WINDOW = 14 * DAY;
const NOT_MEANINGFUL = ["neutral", "out_of_office"];

interface Row { id: string; journeyId: string; direction: string; kind: string; status: string; body: string; generatedBody: string | null; sentText: string | null; angle: string | null; checks: unknown; analysis: unknown; occurredAt: Date | null; createdAt: Date; senderName: string }

export interface LinkedInMetrics {
  drafts: number;
  blocked: number;
  topBlock: string | null;
  sent: number;
  edited: number;
  /** Average share of the AI's text changed in edited messages (0–1). */
  avgChange: number | null;
  replied: number;
  meaningful: number;
  explicitInterest: number;
  handoffs: number;
  byKind: { kind: string; label: string; sent: number; replied: number; meaningful: number }[];
  bySender: { sender: string; sent: number; replied: number; meaningful: number }[];
}

async function rows(since: Date): Promise<Row[]> {
  const m = await db.linkedInMessage.findMany({ where: { createdAt: { gte: since } }, include: { journey: { include: { sender: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } });
  return m.map((x) => ({ ...x, senderName: x.journey.sender.name }));
}

/** For each sent message: the first reply on the same conversation within 14 days, if any. */
function replyTo(sent: Row, all: Row[]): Row | null {
  const at = (sent.occurredAt ?? sent.createdAt).getTime();
  return all.find((r) => r.direction === "in" && r.journeyId === sent.journeyId && (r.occurredAt ?? r.createdAt).getTime() > at && (r.occurredAt ?? r.createdAt).getTime() <= at + REPLY_WINDOW) ?? null;
}

const meaningfulReply = (r: Row | null) => Boolean(r && !NOT_MEANINGFUL.includes(((r.analysis as ReplyAnalysis | null)?.type ?? "neutral")));

export async function linkedinMetrics(days = 90, now = new Date()): Promise<LinkedInMetrics> {
  const since = new Date(now.getTime() - days * DAY);
  const all = await rows(since);
  const out = all.filter((r) => r.direction === "out");
  const sent = out.filter((r) => r.status === "sent");
  const blockedRows = out.filter((r) => r.status === "blocked" || ((r.checks as { pass: boolean }[] | null) ?? []).some((c) => !c.pass));
  const failCount = new Map<string, number>();
  for (const r of blockedRows) for (const c of (r.checks as { check: string; pass: boolean }[] | null) ?? []) if (!c.pass) failCount.set(c.check, (failCount.get(c.check) ?? 0) + 1);
  const changes = sent.filter((r) => r.generatedBody && r.sentText).map((r) => 1 - similarity(r.generatedBody!, r.sentText!)).filter((c) => c > 0.05);
  const replies = sent.map((s) => replyTo(s, all));
  const handoffs = await db.signal.count({ where: { source: "linkedin_manual", occurredAt: { gte: since } } });
  const group = <K extends string>(key: (r: Row) => K) => {
    const m = new Map<K, { sent: number; replied: number; meaningful: number }>();
    sent.forEach((s, i) => {
      const g = m.get(key(s)) ?? { sent: 0, replied: 0, meaningful: 0 };
      g.sent++;
      if (replies[i]) g.replied++;
      if (meaningfulReply(replies[i])) g.meaningful++;
      m.set(key(s), g);
    });
    return m;
  };
  return {
    drafts: out.length,
    blocked: blockedRows.length,
    topBlock: [...failCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    sent: sent.length,
    edited: changes.length,
    avgChange: changes.length ? changes.reduce((t, c) => t + c, 0) / changes.length : null,
    replied: replies.filter(Boolean).length,
    meaningful: replies.filter(meaningfulReply).length,
    explicitInterest: all.filter((r) => r.direction === "in" && (r.analysis as ReplyAnalysis | null)?.intent === "explicit").length,
    handoffs,
    byKind: [...group((r) => r.kind).entries()].map(([kind, g]) => ({ kind, label: KIND_LABEL[kind as MessageKind] ?? kind, ...g })).sort((a, b) => b.sent - a.sent),
    bySender: [...group((r) => r.senderName).entries()].map(([sender, g]) => ({ sender, ...g })).sort((a, b) => b.sent - a.sent),
  };
}

/** Angles that started meaningful conversations for this kind of message (needs 3+ such replies to say anything). */
export async function whatHasWorked(kind: MessageKind, now = new Date()): Promise<string[]> {
  const all = await rows(new Date(now.getTime() - 180 * DAY));
  const sent = all.filter((r) => r.direction === "out" && r.status === "sent" && r.kind === kind && r.angle);
  const wins = sent.filter((s) => meaningfulReply(replyTo(s, all)));
  if (wins.length < 3) return [];
  const rate = Math.round((wins.length / sent.length) * 100);
  return [`${wins.length} of ${sent.length} recent ${KIND_LABEL[kind].toLowerCase()}s started a real conversation (${rate}%). Angles that worked: ${[...new Set(wins.map((w) => w.angle!))].slice(0, 4).join("; ")}.`];
}
