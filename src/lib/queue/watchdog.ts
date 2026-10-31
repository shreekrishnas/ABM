// Keeps the background queue moving between the daily scheduled run. The hosting plan only
// allows a once-a-day schedule, so while people use the app it checks at most every 5 minutes
// (one check across all servers, via a lease) and restarts a queue that has stopped.

import { acquireLease, kickDrain, requeueCutOffRuns } from "./drain";
import { queueHealth } from "@/lib/admin/health";
import { recordError } from "@/lib/admin/errors";

export const WATCHDOG_LEASE = "watchdog";
const EVERY_MS = 5 * 60_000;

/** Returns true when it restarted a stopped queue. */
export async function watchQueue(origin: string | null, now = new Date()): Promise<boolean> {
  try {
    // Holding the lease for 5 minutes means only one check per 5 minutes, whoever triggers it.
    if (!(await acquireLease(WATCHDOG_LEASE, `wd_${now.getTime()}`, EVERY_MS, now))) return false;
    await requeueCutOffRuns();
    const q = await queueHealth(now);
    if (!q.stuck) return false;
    const started = await kickDrain(origin);
    if (!started) await recordError("queue watchdog", new Error("The queue has stopped and could not be restarted (check APP_URL and ABM_API_KEY)"));
    return started;
  } catch (e) {
    await recordError("queue watchdog", e);
    return false;
  }
}
