// Right to erasure: delete personal data, keep a hashed suppression so the
// person is never re-imported, and keep an anonymised audit trail.

import { db } from "@/lib/db";
import { sha256 } from "./crypto";

export async function eraseContact(contactId: string, requestedBy = "data-subject") {
  const c = await db.contact.findUnique({ where: { id: contactId } });
  if (!c) return { erased: false, reason: "Contact not found" };
  if (c.email) {
    await db.suppression.upsert({ where: { value: `sha256:${sha256(c.email)}` }, create: { value: `sha256:${sha256(c.email)}`, reason: "erasure" }, update: {} });
    // Plain-text suppression for this address is removed: only the hash remains.
    await db.suppression.deleteMany({ where: { value: c.email.toLowerCase() } });
  }
  await db.pipelineEvent.create({ data: { accountId: c.accountId, stage: 0, step: "gdpr.erasure", outcome: "info", reason: `Contact erased on request (${requestedBy})` } });
  await db.pipelineEvent.updateMany({ where: { contactId }, data: { contactId: null, reason: "[erased]", data: undefined } });
  await db.reviewItem.deleteMany({ where: { contactId } });
  // Replies reference messages, messages reference drafts: delete in FK order.
  await db.$transaction([
    db.reply.deleteMany({ where: { contactId } }),
    db.message.deleteMany({ where: { contactId } }),
    db.contact.delete({ where: { id: contactId } }),
  ]);
  return { erased: true, reason: "Personal data deleted; hashed suppression kept" };
}
