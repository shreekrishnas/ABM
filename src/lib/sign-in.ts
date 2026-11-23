// Signing in, for the two sign-in route handlers (/login/submit and /login/verify/submit).
// They are route handlers, not server actions, so the request gate (src/proxy.ts) can refuse every
// server action from a signed-out visitor: sign-in is the only thing a signed-out visitor may do.
// The checks are the ones the sign-in server actions made; the result says what to do next.

import { db } from "@/lib/db";
import { LINK_MINUTES, authSecret, domainAllowed, linkSignIn, linkToken, normalizeEmail, sessionToken, verify, type LinkToken } from "@/lib/auth";

export type SignInError = "not_setup" | "no_email" | "rate" | "domain" | "not_member" | "email_failed" | "expired" | "used";
export type SignInResult =
  | { kind: "signed_in"; email: string; token: string; to: string }
  | { kind: "sent"; email: string }
  | { kind: "error"; code: SignInError; email?: string; minutes?: number };

export interface RequestInfo { ip: string; userAgent: string; origin: string }

/** Only same-site paths, never back to the sign-in pages. */
export const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/");

async function landing(email: string, next: string) {
  if (next !== "/") return next;
  const { prefsFor, landingFor } = await import("@/lib/prefs");
  return landingFor(await prefsFor(email));
}

/** Sign in with a work email: only addresses on the allowed domain, of people on the team, get in. */
export async function signInWithEmail(rawEmail: unknown, rawNext: unknown, req: RequestInfo): Promise<SignInResult> {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const secret = authSecret();
  if (!secret) return { kind: "error", code: "not_setup" };
  const email = normalizeEmail(String(rawEmail ?? ""));
  if (!email) return { kind: "error", code: "no_email" };
  // Too many attempts from one address, or for one email: wait before trying again.
  const { hit, LIMITS } = await import("@/lib/rate-limit");
  const [byIp, byEmail] = await Promise.all([hit(`login:ip:${req.ip}`, LIMITS.login.max, LIMITS.login.windowMs), hit(`login:email:${email}`, LIMITS.login.max, LIMITS.login.windowMs)]);
  if (!byIp.ok || !byEmail.ok) return { kind: "error", code: "rate", email, minutes: Math.ceil(Math.max(byIp.retryAfter, byEmail.retryAfter) / 60) };
  if (!domainAllowed(email)) return { kind: "error", code: "domain", email };
  // Only people on the team list get in; Super Admin adds them on Team & Access.
  let member = await db.user.findUnique({ where: { email }, select: { id: true, status: true, sessionVersion: true, lastSignInAt: true } });
  // Test copy only: anyone on the allowed domain can get in, as Super Admin, so it can be checked without setup.
  if (!member && process.env.ABM_TEST_COPY === "true") {
    member = await db.user.create({ data: { email, name: email.split("@")[0], superAdmin: true }, select: { id: true, status: true, sessionVersion: true, lastSignInAt: true } });
    const clients = await db.client.findMany({ select: { id: true } });
    for (const c of clients) await db.userClient.create({ data: { userId: member.id, clientId: c.id, role: "owner" } }).catch(() => undefined);
  }
  const record = (ok: boolean, reason?: string) =>
    db.signInEvent.create({ data: { email, ok, reason: reason ?? null, ip: req.ip.slice(0, 64), userAgent: req.userAgent.slice(0, 300) } }).catch(() => undefined);
  if (!member || member.status !== "active") {
    await record(false, member ? "access removed" : "not on the team");
    return { kind: "error", code: "not_member", email };
  }
  const next = safeNext(rawNext);
  if (linkSignIn()) {
    // Prove the person owns the inbox: email a one-time link instead of signing in directly.
    const base = process.env.APP_URL?.trim().replace(/\/$/, "") || req.origin;
    const token = await linkToken(email, secret, member.lastSignInAt?.getTime() ?? 0);
    const url = `${base}/login/verify?t=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
    try {
      const { SmtpSender } = await import("@/lib/adapters/live/email");
      const from = process.env.SMTP_FROM?.trim() || email;
      await new SmtpSender(process.env.SMTP_URL!.trim(), from).send({ from, to: email, subject: "Your ABM sign-in link", body: `Open this link to sign in. It works once and expires in ${LINK_MINUTES} minutes.\n\n${url}\n\nIf you didn't ask for this, ignore this email.`, idempotencyKey: `login-${Date.now()}` });
    } catch {
      await record(false, "link email failed");
      return { kind: "error", code: "email_failed", email };
    }
    return { kind: "sent", email };
  }
  await Promise.all([record(true), db.user.update({ where: { id: member.id }, data: { lastSignInAt: new Date() } })]);
  return { kind: "signed_in", email, token: await sessionToken(email, secret, member.sessionVersion), to: await landing(email, next) };
}

/** Completes sign-in from an emailed link (a button press, so email scanners that open links can't use it up). */
export async function completeLinkSignIn(rawToken: unknown, rawNext: unknown, req: RequestInfo): Promise<SignInResult> {
  const secret = authSecret();
  const data = secret && typeof rawToken === "string" ? await verify<LinkToken>(rawToken, secret) : null;
  if (!secret || !data || data.kind !== "link") return { kind: "error", code: "expired" };
  const record = (ok: boolean, reason?: string) =>
    db.signInEvent.create({ data: { email: data.email, ok, reason: reason ?? null, ip: req.ip.slice(0, 64), userAgent: req.userAgent.slice(0, 300) } }).catch(() => undefined);
  const member = await db.user.findUnique({ where: { email: data.email }, select: { id: true, status: true, sessionVersion: true, lastSignInAt: true } });
  if (!member || member.status !== "active") { await record(false, "access removed"); return { kind: "error", code: "expired" }; }
  if ((member.lastSignInAt?.getTime() ?? 0) !== data.last) { await record(false, "link already used"); return { kind: "error", code: "used" }; }
  await Promise.all([record(true, "email link"), db.user.update({ where: { id: member.id }, data: { lastSignInAt: new Date() } })]);
  return { kind: "signed_in", email: data.email, token: await sessionToken(data.email, secret, member.sessionVersion), to: await landing(data.email, safeNext(rawNext)) };
}
