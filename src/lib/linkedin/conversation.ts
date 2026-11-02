// One conversation per person across email and LinkedIn, keeping each message's channel, sender
// and date. Used by the LinkedIn workspace (timeline, drafting context, repeat check) and the
// channel recommendation, so nobody gets a fresh pitch on one channel while talking on the other.

import { db } from "@/lib/db";

export interface ConversationItem {
  channel: "email" | "linkedin";
  direction: "out" | "in";
  kind: string;
  sender: string;
  at: Date;
  text: string;
}

export async function contactConversation(contactId: string): Promise<ConversationItem[]> {
  const [emailsOut, emailsIn, li] = await Promise.all([
    db.message.findMany({ where: { contactId, sentAt: { not: null } }, include: { draft: { select: { subject: true, body: true } } }, orderBy: { sentAt: "asc" } }),
    db.reply.findMany({ where: { contactId }, orderBy: { receivedAt: "asc" } }),
    db.linkedInMessage.findMany({ where: { contactId, status: { in: ["sent", "received"] } }, include: { journey: { include: { sender: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const items: ConversationItem[] = [
    ...emailsOut.map((m) => ({ channel: "email" as const, direction: "out" as const, kind: "email", sender: m.mailbox, at: m.sentAt!, text: `${m.draft.subject ? `${m.draft.subject}: ` : ""}${m.draft.body.split(/\n--\n|\nUnsubscribe/i)[0].slice(0, 1200)}` })),
    ...emailsIn.map((r) => ({ channel: "email" as const, direction: "in" as const, kind: `reply (${r.class})`, sender: "prospect", at: r.receivedAt, text: r.body.slice(0, 1200) })),
    ...li.map((m) => ({ channel: "linkedin" as const, direction: m.direction as "out" | "in", kind: m.kind, sender: m.direction === "out" ? m.journey.sender.name : "prospect", at: m.occurredAt ?? m.createdAt, text: (m.sentText ?? m.body).slice(0, 1200) })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

const H48 = 48 * 3_600_000;

/**
 * Which channel to use next, by fixed rules:
 *   1. Continue where they last replied (a reply is the strongest signal of preference).
 *   2. An email went out in the last 48 hours: wait, so they don't get two touches back to back.
 *   3. No usable email address: LinkedIn.
 *   4. An email sequence is running and LinkedIn hasn't started: LinkedIn adds a second, personal channel.
 */
export function recommendChannel(items: ConversationItem[], p: { emailUsable: boolean; sequenceActive: boolean; now?: Date }): { channel: "email" | "linkedin" | "wait"; why: string } {
  const now = p.now ?? new Date();
  const lastIn = [...items].reverse().find((i) => i.direction === "in");
  if (lastIn) return { channel: lastIn.channel, why: `They last replied by ${lastIn.channel === "email" ? "email" : "LinkedIn"} on ${lastIn.at.toISOString().slice(0, 10)}: continue there` };
  const lastEmail = [...items].reverse().find((i) => i.channel === "email" && i.direction === "out");
  if (lastEmail && now.getTime() - lastEmail.at.getTime() < H48) return { channel: "wait", why: `An email went out on ${lastEmail.at.toISOString().slice(0, 10)}: give it 48 hours before a LinkedIn touch` };
  if (!p.emailUsable) return { channel: "linkedin", why: "No usable email address: LinkedIn is the channel" };
  if (p.sequenceActive && !items.some((i) => i.channel === "linkedin")) return { channel: "linkedin", why: "The email sequence is running; LinkedIn adds a personal second channel" };
  return { channel: "linkedin", why: "No reply on either channel yet" };
}
