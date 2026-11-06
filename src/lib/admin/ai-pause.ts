// A Super Admin switch that pauses all AI (OpenRouter) spending. While paused, the background
// queue doesn't start company runs, scheduled AI jobs are skipped, and any AI call is refused
// with a plain message. Kept in the JobLease table (row "ai_pause") so no schema change is needed.

import { baseDb } from "@/lib/db-base";

const KEY = "ai_pause";
let cached: { at: number; paused: { by: string; since: Date } | null } | null = null;

export class AiPaused extends Error {
  constructor() {
    super("AI is paused by a Super Admin (Team & Access › System health). Resume it to continue.");
  }
}

/** Whether AI is paused (cached for 15 s per server instance). */
export async function aiPause(): Promise<{ by: string; since: Date } | null> {
  if (cached && Date.now() - cached.at < 15_000) return cached.paused;
  const row = await baseDb.jobLease.findUnique({ where: { name: KEY } }).catch(() => null);
  const paused = row && row.expiresAt > new Date() ? { by: row.holder, since: row.updatedAt } : null;
  cached = { at: Date.now(), paused };
  return paused;
}

export async function assertAiAllowed(): Promise<void> {
  if (await aiPause()) throw new AiPaused();
}

export async function setAiPaused(paused: boolean, by: string): Promise<void> {
  if (paused) {
    const far = new Date(Date.now() + 10 * 365 * 86_400_000);
    await baseDb.jobLease.upsert({ where: { name: KEY }, create: { name: KEY, holder: by, expiresAt: far }, update: { holder: by, expiresAt: far } });
  } else {
    await baseDb.jobLease.deleteMany({ where: { name: KEY } });
  }
  cached = null;
}
