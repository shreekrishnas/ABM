import { after } from "next/server";
import { checkSignature } from "@/lib/webhook-signature";
import { z } from "zod";
import { baseDb } from "@/lib/db-base";
import { recordReply } from "@/lib/pipeline/stages/engagement";
import { json, parseBody } from "@/lib/api";
import { authorizeClient, threadDraftIds } from "@/lib/api-clients";
import { withSeller } from "@/lib/seller";
import { newContext } from "@/lib/pipeline/context";

// Inbound email webhook: the inbox integration posts replies here.
// The reply is matched to the exact email it answers through the thread headers (our outgoing
// emails carry Message-ID <draftId@abm.local>). Without them, the sender's address is matched
// within the client only, and only when exactly one person there was emailed from that address.
const Body = z.object({
  clientId: z.string().min(1).optional(),
  fromEmail: z.string().email(),
  body: z.string().min(1).max(20000),
  /** The In-Reply-To header of the reply. */
  inReplyTo: z.string().max(2000).optional(),
  /** The References header of the reply. */
  references: z.string().max(10000).optional(),
});

export async function POST(req: Request) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const unsigned = await checkSignature(req);
  if (unsigned) return unsigned;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const auth = await authorizeClient(req, b.data.clientId);
  if ("response" in auth) return auth.response;
  const sellerId = auth.clientId;

  let contactId: string | null = null;
  let messageId: string | null = null;
  // 1. The thread: In-Reply-To first, then References (newest last in the header, so read it reversed).
  const refs = (b.data.references ?? "").split(/\s+/).reverse().join(" ");
  const draftIds = threadDraftIds(b.data.inReplyTo, refs);
  if (draftIds.length) {
    const msgs = await baseDb.message.findMany({ where: { draftId: { in: draftIds }, contact: { account: { sellerId } } }, select: { id: true, draftId: true, contactId: true } });
    const msg = draftIds.map((d) => msgs.find((m) => m.draftId === d)).find(Boolean);
    if (msg) {
      contactId = msg.contactId;
      messageId = msg.id;
    }
  }
  // 2. No usable thread: the sender, within this client, only when unambiguous.
  if (!contactId) {
    const people = await baseDb.contact.findMany({
      where: { email: { equals: b.data.fromEmail, mode: "insensitive" }, mergedIntoId: null, account: { sellerId }, messages: { some: { status: "delivered" } } },
      select: { id: true }, take: 2,
    });
    if (!people.length) return json({ error: "contact_not_found" }, 404);
    if (people.length > 1) return json({ error: "ambiguous_sender", message: "More than one person in this client was emailed from this address; send the In-Reply-To header so the reply can be matched" }, 409);
    contactId = people[0].id;
  }
  const cls = await withSeller(sellerId, () => recordReply(contactId!, b.data.body, newContext(), { messageId }));
  // JARVIS reacts right away (opt-outs on every channel, owner tasks); the daily loop catches anything missed.
  const react = async () => { await (await import("@/lib/agent/events")).processEvents(sellerId).catch(() => undefined); };
  try {
    after(react);
  } catch {
    await react(); // outside a request (tests, scripts): handle it now
  }
  return json({ contactId, messageId, class: cls }, 202);
}
