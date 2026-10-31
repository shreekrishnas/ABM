// Optional tech-lookup provider: BuiltWith's Domain API (set BUILTWITH_API_KEY). It reports what a
// domain's sites have run, with first and last detection dates. Only technologies seen in the last
// 12 months are kept; catalog products keep their canonical names, the rest are filed by BuiltWith tag.

import { fetchJson } from "@/lib/adapters/live/http";
import { matchTech, type TechCategory } from "./catalog";

interface BwTech { Name: string; Tag?: string; Categories?: string[] | null; FirstDetected?: number; LastDetected?: number }
interface BwResponse { Results?: { Result?: { Paths?: { Technologies?: BwTech[] }[] } }[]; Errors?: { Message?: string }[] }

/** BuiltWith tags worth keeping, and the category each maps to. Plumbing (DNS, SSL, JS libraries, fonts) is skipped. */
const TAG_CATEGORY: Record<string, TechCategory> = {
  analytics: "analytics", cms: "cms", ecommerce: "ecommerce", shop: "ecommerce", hosting: "cloud", cdn: "cloud", cloud: "cloud",
  crm: "crm", "marketing-automation": "marketing_automation", email: "marketing_automation", livechat: "customer_support", "customer-service": "customer_support",
};

export interface ProviderTech { name: string; vendor: string | null; category: TechCategory; detail: string }

export function mapBuiltWith(res: BwResponse, now = new Date()): ProviderTech[] {
  const cutoff = now.getTime() - 365 * 86_400_000;
  const out = new Map<string, ProviderTech>();
  for (const r of res.Results ?? []) for (const p of r.Result?.Paths ?? []) for (const t of p.Technologies ?? []) {
    if (!t.Name || (t.LastDetected && t.LastDetected < cutoff)) continue;
    const entry = matchTech(t.Name);
    const tag = (t.Tag ?? "").toLowerCase();
    const category = entry?.category ?? TAG_CATEGORY[tag];
    if (!category) continue;
    const name = entry?.name ?? t.Name;
    if (out.has(name)) continue;
    const last = t.LastDetected ? new Date(t.LastDetected).toISOString().slice(0, 10) : null;
    out.set(name, { name, vendor: entry?.vendor ?? null, category, detail: `BuiltWith${tag ? ` (${tag})` : ""}${last ? `, last seen ${last}` : ""}` });
  }
  return [...out.values()];
}

export async function builtWithLookup(domain: string): Promise<ProviderTech[]> {
  const key = process.env.BUILTWITH_API_KEY?.trim();
  if (!key) return [];
  const url = `https://api.builtwith.com/v21/api.json?KEY=${encodeURIComponent(key)}&LOOKUP=${encodeURIComponent(domain)}`;
  try {
    return mapBuiltWith(await fetchJson<BwResponse>("builtwith", url, { timeoutMs: 20_000 }));
  } catch {
    return [];
  }
}
