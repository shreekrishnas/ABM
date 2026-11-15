// Learning: an email that got a positive reply becomes an example in the knowledge
// base, tagged with the play and persona it was written for. Retrieval prefers these
// over the built-in starter examples, so the writer improves from your own results.

import { db } from "@/lib/db";
import { messageBody } from "../playbook";
import { upsertKeyedDoc } from "./store";
import { ensureSellerPacks, sellerFor } from "@/lib/seller";

export async function learnFromPositiveReply(contactId: string): Promise<boolean> {
  const msg = await db.message.findFirst({
    where: { contactId, status: "delivered" },
    orderBy: { sentAt: "desc" },
    include: { draft: true, contact: { include: { account: true } } },
  });
  const d = msg?.draft;
  if (!d || !d.sellerId) return false;
  const k = (d.knowledge ?? {}) as { play?: string; persona?: string | null };
  const c = msg.contact;
  await ensureSellerPacks();
  let sender: string | undefined;
  try {
    sender = sellerFor(d.sellerId).sender.name;
  } catch {
    sender = undefined;
  }
  const body = messageBody(d.body, sender);
  return upsertKeyedDoc(d.sellerId, "learned", {
    key: `learned:draft:${d.id}`,
    kind: "example",
    title: `Got a positive reply: step ${d.stepOrder} to ${c.titleNormalized ?? c.title ?? "a contact"}${c.account.industry ? ` (${c.account.industry})` : ""}`,
    text: `Subject: ${d.subject}\n\n${body}\n\nWhy it works: ${c.titleNormalized ?? "the recipient"} replied positively${d.useCase ? ` to the ${d.useCase.replace(/_/g, " ")} angle` : ""}. Imitate the shape and tone, not the details.`,
    tags: { channel: "email", plays: k.play ? [k.play] : undefined, personas: k.persona ? [k.persona] : undefined, useCases: d.useCase ? [d.useCase] : undefined },
    approved: false,
  });
}

// ── Learning from the team's review ──

const sentences = (t: string) => t.replace(/\r\n?/g, "\n").split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What changed between the draft and what the team approved, in plain lessons. Pure. */
export function editLessons(before: { subject: string; body: string }, after: { subject: string; body: string }): string[] {
  const was = sentences(before.body), now = sentences(after.body);
  const nowSet = new Set(now.map(norm)), wasSet = new Set(was.map(norm));
  const removed = was.filter((s) => !nowSet.has(norm(s)));
  const added = now.filter((s) => !wasSet.has(norm(s)));
  const out: string[] = [];
  if (before.subject.trim() !== after.subject.trim()) out.push(`Subject "${before.subject.trim()}" was changed to "${after.subject.trim()}"`);
  for (const s of removed.slice(0, 3)) out.push(`The team cut: "${s.slice(0, 200)}"`);
  for (const s of added.slice(0, 3)) out.push(`The team wrote instead: "${s.slice(0, 200)}"`);
  return out;
}

/**
 * Save what the team did with a draft as lessons for the writer (no AI, no embedding: always works),
 * and an approved edited email as a good example for the same play.
 */
export async function learnFromReview(d: { id: string; sellerId: string | null; stepOrder: number; useCase: string | null; knowledge: unknown; contactTitle: string | null }, review: { decision: "approve" | "reject"; edited: boolean; note: string | null; before: { subject: string; body: string }; after: { subject: string; body: string } }): Promise<string[]> {
  if (!d.sellerId) return [];
  const lessons = review.decision === "approve" && review.edited ? editLessons(review.before, review.after) : [];
  if (review.decision === "reject") {
    const opening = sentences(review.before.body.split(/\n\n/).slice(1).join("\n\n") || review.before.body)[0];
    lessons.push(`An email was rejected${review.note ? ` because: "${review.note.slice(0, 200)}"` : ""}${opening ? `. It opened: "${opening.slice(0, 160)}"` : ""}`);
  } else if (review.note) lessons.push(`Reviewer's note: "${review.note.slice(0, 200)}"`);
  if (!lessons.length) return [];
  const k = (d.knowledge ?? {}) as { play?: string; persona?: string | null };
  await db.knowledgeDoc.upsert({
    where: { sellerId_key: { sellerId: d.sellerId, key: `lesson:draft:${d.id}` } },
    create: { sellerId: d.sellerId, key: `lesson:draft:${d.id}`, origin: "learned", kind: "norm", title: `Team ${review.decision === "reject" ? "rejection" : "edit"}: step ${d.stepOrder} to ${d.contactTitle ?? "a contact"}`, text: lessons.join("\n"), tags: { plays: k.play ? [k.play] : undefined, personas: k.persona ? [k.persona] : undefined, lesson: true }, approved: false, hash: `lesson:${d.id}:${lessons.length}` },
    update: { text: lessons.join("\n"), hash: `lesson:${d.id}:${lessons.length}` },
  });
  // The approved edited email: a good example of what the team wants (best effort: needs the embedder).
  if (review.decision === "approve" && review.edited) {
    let sender: string | undefined;
    try {
      await ensureSellerPacks();
      sender = sellerFor(d.sellerId).sender.name;
    } catch {
      sender = undefined;
    }
    await upsertKeyedDoc(d.sellerId, "learned", {
      key: `learned:edit:${d.id}`, kind: "example",
      title: `Approved after the team edited it: step ${d.stepOrder} to ${d.contactTitle ?? "a contact"}`,
      text: `Subject: ${review.after.subject}\n\n${messageBody(review.after.body, sender)}\n\nWhy it works: this is the version the team approved after editing. Imitate the shape and tone, not the details.`,
      tags: { channel: "email", plays: k.play ? [k.play] : undefined, personas: k.persona ? [k.persona] : undefined, useCases: d.useCase ? [d.useCase] : undefined },
      approved: false,
    }).catch(() => false);
  }
  return lessons;
}

/** The team's latest lessons for a client, newest first, for the writer to follow. */
export async function teamLessons(sellerId: string, limit = 8): Promise<string[]> {
  const docs = await db.knowledgeDoc.findMany({ where: { sellerId, key: { startsWith: "lesson:draft:" } }, orderBy: { updatedAt: "desc" }, take: 12, select: { text: true } });
  return docs.flatMap((d) => d.text.split("\n")).filter(Boolean).slice(0, limit);
}
