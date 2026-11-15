// Things that quietly stop the platform working, found from records it already keeps: the AI
// provider refusing calls (a key or credit limit), the daily check not running, and website
// visitors no longer arriving. Shown to Super Admins in notifications and on System health.

import { baseDb } from "@/lib/db-base";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SystemAlert {
  key: "ai_blocked" | "daily_missed" | "visitors_quiet";
  tone: "bad" | "warn";
  title: string;
  detail: string;
  /** What a person should do about it. */
  fix: string;
  href: string;
  at: Date;
}

/** OpenRouter's own words for "this key or account can't spend any more". */
const LIMIT = /key limit exceeded|monthly limit|insufficient (credits|balance)|out of credits|payment required|\b402\b/i;

export async function systemAlerts(now = new Date()): Promise<SystemAlert[]> {
  const out: SystemAlert[] = [];
  const [limitErr, daily, newestVisit, everVisited, apolloOn] = await Promise.all([
    baseDb.errorLog.findFirst({ where: { lastSeen: { gte: new Date(now.getTime() - 3 * DAY) }, message: { contains: "OpenRouter" } }, orderBy: { lastSeen: "desc" }, select: { message: true, lastSeen: true } }),
    baseDb.runLog.findFirst({ where: { job: "Daily check" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, ok: true, note: true } }),
    baseDb.webVisit.findFirst({ where: { source: "apollo", OR: [{ title: null }, { NOT: { title: { contains: "visit date unknown" } } }] }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    baseDb.webVisit.count({ where: { source: "apollo" } }),
    Promise.resolve(Boolean(process.env.APOLLO_API_KEY?.trim())),
  ]);

  // The AI provider refused calls for lack of budget: research and drafting stop until it's raised.
  if (limitErr && LIMIT.test(limitErr.message)) {
    // Every refused call moves the error's "last seen"; AI calls logged well after it went through, so it's fixed.
    const callsSince = await baseDb.ledgerEntry.count({ where: { createdAt: { gt: new Date(limitErr.lastSeen.getTime() + 60_000) }, kind: "llm" } });
    if (callsSince < 3) {
      const used = limitErr.message.match(/\$[\d.]+ of \$[\d.]+ used/)?.[0];
      out.push({
        key: "ai_blocked", tone: "bad", title: "AI is blocked: the OpenRouter key hit its spending limit",
        detail: `${used ? `${used}. ` : ""}Research and email drafting stop until the limit is raised. Last refused ${limitErr.lastSeen.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`,
        fix: "In OpenRouter → Keys, raise (or remove) this key's monthly limit. Nothing needs changing in the app.",
        href: "/team?tab=system", at: limitErr.lastSeen,
      });
    }
  }

  // The scheduled daily check (research queue, daily prospecting, website visitors) didn't run.
  if (!daily || now.getTime() - daily.startedAt.getTime() > 30 * HOUR) {
    out.push({
      key: "daily_missed", tone: "warn", title: "The daily check didn't run",
      detail: daily ? `Last run ${daily.startedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} IST. Website visitors, daily prospecting and queued research wait until it runs.` : "It has never run.",
      fix: "Check the scheduled job in Vercel (Settings → Cron Jobs). You can press 'Fetch visitors from Apollo now' or 'Run now' meanwhile.",
      href: "/team?tab=system", at: daily?.startedAt ?? now,
    });
  } else if (daily && !daily.ok) {
    out.push({ key: "daily_missed", tone: "warn", title: "The daily check failed", detail: daily.note?.slice(0, 200) ?? "No reason recorded.", fix: "Open System health for the error; it retries tomorrow.", href: "/team?tab=system", at: daily.startedAt });
  }

  // Website visitors stopped arriving (the tracking script, the Apollo workflow or the list).
  if (apolloOn && everVisited && (!newestVisit || now.getTime() - newestVisit.occurredAt.getTime() > 14 * DAY)) {
    out.push({
      key: "visitors_quiet", tone: "warn", title: "No new website visitors for over two weeks",
      detail: newestVisit ? `The newest visit Apollo has sent is from ${newestVisit.occurredAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.` : "No dated visits yet.",
      fix: "Check that Apollo's tracking script on the website is recording visits, and that the Apollo workflow adds visitors to the visitor list.",
      href: "/import/apollo", at: newestVisit?.occurredAt ?? now,
    });
  }
  return out;
}
