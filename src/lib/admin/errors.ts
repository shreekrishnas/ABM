// Server errors kept in the database (the host keeps logs for an hour), grouped so the same
// failure in the same place is one row with a count. Shown on Team & Access → System health.

import { createHash } from "node:crypto";
import { baseDb } from "@/lib/db-base";

/** Numbers, ids and quoted values vary between occurrences of the same failure: drop them for grouping. */
function normalise(message: string) {
  return message.replace(/[0-9a-f]{8,}/gi, "#").replace(/\d+/g, "#").replace(/"[^"]*"|'[^']*'/g, "…").slice(0, 300);
}

/** Record an error; never throws (reporting must not cause another failure). */
export async function recordError(source: string, err: unknown, detail?: string): Promise<void> {
  try {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000) || "Unknown error";
    const fingerprint = createHash("sha1").update(`${source}|${normalise(message)}`).digest("hex");
    const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : undefined;
    const extra = [detail, stack].filter(Boolean).join("\n").slice(0, 2000) || null;
    await baseDb.errorLog.upsert({
      where: { fingerprint },
      create: { fingerprint, source: source.slice(0, 200), message, detail: extra },
      update: { count: { increment: 1 }, lastSeen: new Date(), message, detail: extra },
    });
  } catch {
    // The database itself may be the problem; the host's logs still have it.
  }
}

export async function recentErrors(limit = 20) {
  return baseDb.errorLog.findMany({ orderBy: { lastSeen: "desc" }, take: limit });
}

/** Clear errors a Super Admin has looked at. */
export async function clearErrors() {
  await baseDb.errorLog.deleteMany({});
}
