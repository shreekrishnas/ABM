import { z } from "zod";
import { authorize, json, parseBody } from "@/lib/api";
import { recordVisit } from "@/lib/web/visits";

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
  const denied = authorize(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if ("error" in b) return b.error;
  const visits = "visits" in b.data ? b.data.visits : [b.data];
  let matched = 0;
  for (const v of visits) if ((await recordVisit({ ...v, source: "reverse_ip" })).accountId) matched++;
  return json({ received: visits.length, matched, unknown: visits.length - matched }, 202);
}
