// Facts stored before the precision fields existed get them the first time their company is
// opened: canonical link, own-site tier, event date and confidence. Code only, no AI or search.

import { db } from "@/lib/db";
import { canonicalUrl, eventDateFrom, hostOf, ownSiteTier } from "./precision";

export async function ensurePrecision(accountId: string, domain: string | null, now = new Date()): Promise<number> {
  const rows = await db.evidence.findMany({ where: { accountId, confidence: null } });
  if (!rows.length) return 0;
  const d = domain?.toLowerCase().replace(/^www\./, "") ?? null;
  for (const r of rows) {
    if (r.flagged || r.supersededById) {
      await db.evidence.update({ where: { id: r.id }, data: { confidence: 0, canonicalUrl: r.canonicalUrl ?? canonicalUrl(r.sourceUrl) } });
      continue;
    }
    const host = hostOf(r.sourceUrl);
    let sourceType = r.sourceType;
    if (sourceType === "official" && d && (host === d || host.endsWith(`.${d}`))) {
      try {
        sourceType = ownSiteTier(new URL(r.sourceUrl).pathname);
      } catch {
        /* keep */
      }
    }
    const event = r.eventDate ?? eventDateFrom(r.quote, r.publishedAt);
    await db.evidence.update({
      where: { id: r.id },
      data: {
        canonicalUrl: canonicalUrl(r.sourceUrl), sourceType, eventDate: event, pageDate: r.pageDate ?? r.publishedAt,
        ...(event && event.getTime() < r.publishedAt.getTime() ? { publishedAt: event } : {}),
      },
    });
  }
  const { refreshStatuses } = await import("@/lib/pipeline/stages/research");
  await refreshStatuses(accountId, now);
  return rows.length;
}
