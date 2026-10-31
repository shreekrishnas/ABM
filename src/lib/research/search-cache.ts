// Web search results reused for 48 hours: the same search (same engine choice, question and
// company) isn't paid for twice, even across accounts. Only non-empty results are kept.

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import type { ResearchPage } from "@/lib/adapters/types";

export const SEARCH_CACHE_HOURS = 48;

// Off under the test runner (tests stub the engines and must see every call); a test can switch it on.
let enabled = !process.env.VITEST;
export function setSearchCache(on: boolean) {
  enabled = on;
}

export function searchKey(parts: (string | undefined | null)[]): string {
  return createHash("sha1").update(parts.map((p) => p ?? "").join("|").toLowerCase()).digest("hex");
}

export async function cachedPages(key: string, now = new Date()): Promise<ResearchPage[] | null> {
  if (!enabled) return null;
  try {
    const row = await baseDb.searchCache.findUnique({ where: { key } });
    if (!row || now.getTime() - row.createdAt.getTime() > SEARCH_CACHE_HOURS * 3_600_000) return null;
    return (row.pages as unknown as (Omit<ResearchPage, "publishedAt" | "retrievedAt"> & { publishedAt: string; retrievedAt?: string })[]).map((p) => ({
      ...p,
      publishedAt: new Date(p.publishedAt),
      ...(p.retrievedAt ? { retrievedAt: new Date(p.retrievedAt) } : {}),
    })) as ResearchPage[];
  } catch {
    return null; // a cache problem never stops research
  }
}

export async function storePages(key: string, pages: ResearchPage[]): Promise<void> {
  if (!enabled || !pages.length) return;
  try {
    const json = pages as unknown as Prisma.InputJsonValue;
    await baseDb.searchCache.upsert({ where: { key }, create: { key, pages: json }, update: { pages: json, createdAt: new Date() } });
    // Keep the table small: drop entries past their time now and then.
    if (Math.random() < 0.02) await baseDb.searchCache.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - SEARCH_CACHE_HOURS * 3_600_000) } } });
  } catch {
    // ignore
  }
}
