import { z } from "zod";
import { db } from "@/lib/db";
import { eraseContact } from "@/lib/pipeline/gdpr";
import { sha256 } from "@/lib/pipeline/crypto";
import { authorize, json, parseBody } from "@/lib/api";

// Right-to-erasure requests by email. Always records a hashed suppression,
// even if we hold no record, so the person is never imported later.
const Body = z.object({ email: z.string().email(), requestedBy: z.string().max(100).default("data-subject") });

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const email = b.data.email.toLowerCase();
  const contacts = await db.contact.findMany({ where: { email } });
  for (const c of contacts) await eraseContact(c.id, b.data.requestedBy);
  await db.suppression.upsert({ where: { value: `sha256:${sha256(email)}` }, create: { value: `sha256:${sha256(email)}`, reason: "erasure" }, update: {} });
  return json({ erased: contacts.length });
}
