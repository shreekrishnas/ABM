// Daily housekeeping from the morning check: drop data past its useful life so the database
// stays small and fast. Only caches, logs of machine events and expired helper rows are touched;
// the audit trail (PipelineEvent), facts (Evidence), spend (LedgerEntry) and CRM records never are.
// Every step works in batches so no table is locked for long.

import { baseDb } from "@/lib/db-base";
import { CONFIG } from "@/lib/config";
import { SEARCH_CACHE_HOURS } from "@/lib/research/search-cache";

const DAY = 86_400_000;
const BATCH = 5_000;
/** Page text in research history is needed only while the search can be reused; after this it's trimmed to links. */
export const PAGE_TEXT_DAYS = Math.max(30, CONFIG.brain.searchCacheDays * 2);
export const BRAIN_SIGNAL_DAYS = 90;
export const DAILY_LIST_DAYS = 90;
export const CAREERS_RETRY_DAYS = 60;

export interface HousekeepingResult {
  searchCache: number;
  pagesTrimmed: number;
  brainSignals: number;
  rateLimits: number;
  dailyLists: number;
  careersRetried: number;
}

/** Delete rows matching `where` in batches of ids (Prisma's deleteMany has no limit). */
async function deleteInBatches(find: () => Promise<{ id: string }[]>, del: (ids: string[]) => Promise<{ count: number }>): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const ids = (await find()).map((r) => r.id);
    if (!ids.length) break;
    total += (await del(ids)).count;
    if (ids.length < BATCH) break;
  }
  return total;
}

export async function runHousekeeping(now = new Date()): Promise<HousekeepingResult> {
  const before = (days: number) => new Date(now.getTime() - days * DAY);

  // Search results reused across companies for 48 hours; past that they are never read.
  const searchCache = (await baseDb.searchCache.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - SEARCH_CACHE_HOURS * 3_600_000) } } })).count;

  // Research history keeps every query and source link; the full page text is dropped once the search can't be reused.
  let pagesTrimmed = 0;
  for (let i = 0; i < 20; i++) {
    const n = await baseDb.$executeRaw`
      UPDATE "ResearchQuery" q SET "pages" = (SELECT jsonb_agg(p - 'text') FROM jsonb_array_elements(q."pages") p)
      WHERE q."id" IN (
        SELECT "id" FROM "ResearchQuery"
        WHERE "createdAt" < ${before(PAGE_TEXT_DAYS)} AND "pages" IS NOT NULL AND jsonb_typeof("pages") = 'array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements("pages") e WHERE e ? 'text')
        LIMIT ${BATCH})`;
    pagesTrimmed += n;
    if (n < BATCH) break;
  }

  // Machine events behind the AI's decisions: replayable for 90 days.
  const brainSignals = await deleteInBatches(
    () => baseDb.brainSignal.findMany({ where: { createdAt: { lt: before(BRAIN_SIGNAL_DAYS) } }, select: { id: true }, take: BATCH }),
    (ids) => baseDb.brainSignal.deleteMany({ where: { id: { in: ids } } }),
  );

  // Rate-limit windows are a minute to an hour long; a day-old one is dead.
  const rateLimits = await baseDb.$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < ${before(1)}`;

  const dailyLists = (await baseDb.dailyRecommendation.deleteMany({ where: { createdAt: { lt: before(DAILY_LIST_DAYS) } } })).count;

  // A careers site with no job feed (or an error) is checked again after a while: sites change.
  const careersRetried = (await baseDb.careersFeed.deleteMany({ where: { status: { in: ["none", "error"] }, lastCheckedAt: { lt: before(CAREERS_RETRY_DAYS) } } })).count;

  return { searchCache, pagesTrimmed, brainSignals, rateLimits, dailyLists, careersRetried };
}

/** From the morning check: run once, record the outcome in Super Admin → Operations. */
export async function housekeepingTick(now = new Date()) {
  const { recordRun } = await import("./ops");
  const started = new Date();
  try {
    const r = await runHousekeeping(now);
    const total = Object.values(r).reduce((a, b) => a + b, 0);
    await recordRun("Housekeeping", started, { ok: true, processed: total, note: Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing to clean" });
    return r;
  } catch (e) {
    await recordRun("Housekeeping", started, { ok: false, note: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
