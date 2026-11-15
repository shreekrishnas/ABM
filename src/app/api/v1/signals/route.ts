import { z } from "zod";
import { baseDb } from "@/lib/db-base";
import { normalizeDomain } from "@/lib/pipeline/normalize";
import { recordSignal } from "@/lib/pipeline/stages/engagement";
import { json, parseBody } from "@/lib/api";
import { authorizeClient } from "@/lib/api-clients";
import { withSeller } from "@/lib/seller";

// Webhook for the tracking script, intent provider and email provider.
// Identify the account by id or by domain (reverse-IP lookups give a domain), always within the
// client the key belongs to (or the client named with the workspace key): a signal never lands on
// another client's record of the same company.
const Body = z.object({
  clientId: z.string().min(1).optional(),
  accountId: z.string().optional(),
  domain: z.string().optional(),
  contactEmail: z.string().email().optional(),
  type: z.enum(["email_open", "email_click", "email_reply", "site_visit", "pricing_visit", "intent_surge", "job_change", "event_attended", "content_download"]),
  source: z.string().max(40).default("webhook"),
  detail: z.string().max(300).optional(),
  occurredAt: z.coerce.date().optional(),
}).refine((b) => b.accountId || b.domain, { message: "accountId or domain is required" });

export async function POST(req: Request) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const auth = await authorizeClient(req, b.data.clientId);
  if ("response" in auth) return auth.response;
  const sellerId = auth.clientId;
  const domain = normalizeDomain(b.data.domain);
  const account = b.data.accountId
    ? await baseDb.account.findFirst({ where: { id: b.data.accountId, sellerId } })
    : domain ? await baseDb.account.findFirst({ where: { sellerId, domain } }) : null;
  if (!account) return json({ error: "account_not_found" }, 404);
  const contact = b.data.contactEmail ? await baseDb.contact.findFirst({ where: { accountId: account.mergedIntoId ?? account.id, email: b.data.contactEmail.toLowerCase() } }) : null;
  const updated = await withSeller(sellerId, () => recordSignal({ accountId: account.mergedIntoId ?? account.id, contactId: contact?.id, type: b.data.type, source: b.data.source, detail: b.data.detail, occurredAt: b.data.occurredAt }));
  return json({ accountId: updated.id, stage: updated.stage, engagementScore: updated.engagementScore }, 202);
}
