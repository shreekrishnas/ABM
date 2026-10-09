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
