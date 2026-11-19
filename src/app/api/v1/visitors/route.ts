import { checkSignature } from "@/lib/webhook-signature";
import { z } from "zod";
import { json, parseBody } from "@/lib/api";
import { authorizeClient } from "@/lib/api-clients";
import { withSeller } from "@/lib/seller";
import { recordVisit } from "@/lib/web/visits";
import { suggestFromVisitors } from "@/lib/discover/visitors";
import { newContext } from "@/lib/pipeline/context";

// Webhook for reverse-IP visitor tools (Dealfront/Leadfeeder, Albacross, RB2B…): they name the
// company behind an anonymous visit. Known companies get a signal; unknown ones show in Discover.
const Visit = z.object({
  companyName: z.string().min(1).max(120).optional(),
  companyDomain: z.string().max(120).optional(),
  url: z.string().url().max(500),
  title: z.string().max(200).optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  occurredAt: z.coerce.date().optional(),
}).refine((v) => v.companyName || v.companyDomain, { message: "companyName or companyDomain is required" });
const Body = z.union([Visit, z.object({ visits: z.array(Visit).min(1).max(500) })]);

export async function POST(req: Request) {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const unsigned = await checkSignature(req);
  if (unsigned) return unsigned;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  // The client whose website was visited: the key's client (or the one named with the workspace key).
  const auth = await authorizeClient(req);
  if ("response" in auth) return auth.response;
  const visits = "visits" in b.data ? b.data.visits : [b.data];
  let matched = 0;
  for (const v of visits) if ((await recordVisit({ ...v, source: "reverse_ip", sellerId: auth.clientId })).accountId) matched++;
  const s = matched < visits.length ? await withSeller(auth.clientId, () => suggestFromVisitors(newContext())) : { suggested: 0, excluded: 0 };
  return json({ received: visits.length, matched, unknown: visits.length - matched, ...s }, 202);
}
