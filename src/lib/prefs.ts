// Personal preferences, kept on the person (User.prefs).
import { db } from "@/lib/db";

import { HOMES, type NoticeKind } from "@/lib/prefs-shared";
export { HOMES, NOTICE_KINDS, type NoticeKind } from "@/lib/prefs-shared";

export interface Prefs { home?: string; mute?: NoticeKind[]; dismissed?: string[] }

export async function prefsFor(email: string | null | undefined): Promise<Prefs> {
  if (!email) return {};
  const u = await db.user.findUnique({ where: { email }, select: { prefs: true } }).catch(() => null);
  return (u?.prefs as Prefs | null) ?? {};
}

/** Where to land after sign-in when no page was asked for. */
export const landingFor = (p: Prefs) => (HOMES.some((h) => h.value === p.home) ? p.home! : "/");
