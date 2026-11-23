// Is this session still good? One answer for the request gate (src/proxy.ts), the data layer
// (resolveScope) and the app (getMe). A session works only while its signature is valid, its email
// is on an allowed domain, its person is on the team (active), and it hasn't been ended since it was
// issued ("Sign out everywhere", or a Super Admin ending someone's sessions, raise the person's
// session version). Checked against the database on every request, so a removal or an ended session
// stops working on the very next request, on every server.

import { baseDb } from "@/lib/db-base";
import { authSecret, domainAllowed, verify, type Session } from "@/lib/auth";

export type SessionState =
  | { ok: true; email: string; userId: string; version: number }
  /** none: no cookie. invalid: forged, malformed or expired. domain: not an allowed domain.
   *  unknown: no such person. inactive: removed or disabled. ended: signed out everywhere since. */
  | { ok: false; reason: "none" | "invalid" | "domain" | "unknown" | "inactive" | "ended" };

export async function checkSession(token: string | null | undefined): Promise<SessionState> {
  if (!token) return { ok: false, reason: "none" };
  const secret = authSecret();
  const session = secret ? await verify<Session>(token, secret) : null;
  if (!session) return { ok: false, reason: "invalid" };
  if (!domainAllowed(session.email)) return { ok: false, reason: "domain" };
  const user = await baseDb.user.findUnique({ where: { email: session.email }, select: { id: true, status: true, sessionVersion: true } });
  if (!user) return { ok: false, reason: "unknown" };
  if (user.status !== "active") return { ok: false, reason: "inactive" };
  if ((session.v ?? 0) !== user.sessionVersion) return { ok: false, reason: "ended" };
  return { ok: true, email: session.email, userId: user.id, version: user.sessionVersion };
}
