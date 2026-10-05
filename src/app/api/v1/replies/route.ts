import { z } from "zod";
import { db } from "@/lib/db";
import { recordReply } from "@/lib/pipeline/stages/engagement";
import { authorize, json, parseBody } from "@/lib/api";

// Inbound email webhook: the inbox integration posts replies here.
const Body = z.object({ fromEmail: z.string().email(), body: z.string().min(1).max(20000) });

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const contact = await db.contact.findFirst({ where: { email: b.data.fromEmail.toLowerCase(), mergedIntoId: null } });
  if (!contact) return json({ error: "contact_not_found" }, 404);
  const cls = await recordReply(contact.id, b.data.body);
  return json({ contactId: contact.id, class: cls }, 202);
}
