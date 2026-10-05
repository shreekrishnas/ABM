import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/pipeline/normalize";
import { recordSignal } from "@/lib/pipeline/stages/engagement";
import { authorize, json, parseBody } from "@/lib/api";

// Webhook for the tracking script, intent provider and email provider.
// Identify the account by id or by domain (reverse-IP lookups give a domain).
const Body = z.object({
  accountId: z.string().optional(),
  domain: z.string().optional(),
  contactEmail: z.string().email().optional(),
  type: z.enum(["email_open", "email_click", "email_reply", "site_visit", "pricing_visit", "intent_surge", "job_change", "event_attended", "content_download"]),
  source: z.string().max(40).default("webhook"),
  detail: z.string().max(300).optional(),
  occurredAt: z.coerce.date().optional(),
}).refine((b) => b.accountId || b.domain, { message: "accountId or domain is required" });

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const domain = normalizeDomain(b.data.domain);
  const account = b.data.accountId ? await db.account.findUnique({ where: { id: b.data.accountId } }) : domain ? await db.account.findUnique({ where: { domain } }) : null;
  if (!account) return json({ error: "account_not_found" }, 404);
  const contact = b.data.contactEmail ? await db.contact.findFirst({ where: { accountId: account.id, email: b.data.contactEmail.toLowerCase() } }) : null;
  const updated = await recordSignal({ accountId: account.mergedIntoId ?? account.id, contactId: contact?.id, type: b.data.type, source: b.data.source, detail: b.data.detail, occurredAt: b.data.occurredAt });
  return json({ accountId: updated.id, stage: updated.stage, engagementScore: updated.engagementScore }, 202);
}
