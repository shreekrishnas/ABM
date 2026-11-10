"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { MODE_COOKIE, audit, getMe } from "@/lib/me";
import { SESSION_COOKIE, SESSION_DAYS, LINK_MINUTES, allowedDomains, authSecret, domainAllowed, linkSignIn, linkToken, normalizeEmail, sessionToken, verify, type LinkToken } from "@/lib/auth";

export type LoginState = { email?: string; error?: string; sent?: boolean };

const safeNext = (n: FormDataEntryValue | null) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/");

/** Sign in with a work email: only addresses on the allowed domain get in. */
export async function loginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const secret = authSecret();
  if (!secret) return { error: "Sign-in isn't set up yet: add AUTH_SECRET in Vercel." };
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  if (!email) return { error: "Enter your work email address." };
  // Too many attempts from one address, or for one email: wait before trying again.
  const { hit, clientIp, LIMITS } = await import("@/lib/rate-limit");
  const ip = clientIp(await headers());
  const [byIp, byEmail] = await Promise.all([hit(`login:ip:${ip}`, LIMITS.login.max, LIMITS.login.windowMs), hit(`login:email:${email}`, LIMITS.login.max, LIMITS.login.windowMs)]);
  if (!byIp.ok || !byEmail.ok) return { email, error: `Too many sign-in attempts. Try again in ${Math.ceil(Math.max(byIp.retryAfter, byEmail.retryAfter) / 60)} minutes.` };
  if (!domainAllowed(email)) return { email, error: `Only @${allowedDomains().join(" or @")} addresses can sign in.` };
  // Only people on the team list get in; Super Admin adds them on Team & Access.
  const member = await db.user.findUnique({ where: { email }, select: { id: true, status: true, sessionVersion: true, lastSignInAt: true } });
  const h = await headers();
  const record = (ok: boolean, reason?: string) =>
    db.signInEvent.create({ data: { email, ok, reason: reason ?? null, ip: ip.slice(0, 64), userAgent: (h.get("user-agent") ?? "").slice(0, 300) } }).catch(() => undefined);
  if (!member || member.status !== "active") {
    await record(false, member ? "access removed" : "not on the team");
    return { email, error: "You're not on the team yet. Ask a Super Admin to add you in Team & Access." };
  }
  if (linkSignIn()) {
    // Prove the person owns the inbox: email a one-time link instead of signing in directly.
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const base = process.env.APP_URL?.trim().replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
    const token = await linkToken(email, secret, member.lastSignInAt?.getTime() ?? 0);
    const url = `${base}/login/verify?t=${encodeURIComponent(token)}&next=${encodeURIComponent(safeNext(fd.get("next")))}`;
    try {
      const { SmtpSender } = await import("@/lib/adapters/live/email");
      const from = process.env.SMTP_FROM?.trim() || email;
      await new SmtpSender(process.env.SMTP_URL!.trim(), from).send({ from, to: email, subject: "Your ABM sign-in link", body: `Open this link to sign in. It works once and expires in ${LINK_MINUTES} minutes.\n\n${url}\n\nIf you didn't ask for this, ignore this email.`, idempotencyKey: `login-${Date.now()}` });
    } catch {
      await record(false, "link email failed");
      return { email, error: "We couldn't send the sign-in email. Try again in a minute, or ask a Super Admin." };
    }
    return { email, sent: true };
  }
  await Promise.all([record(true), db.user.update({ where: { id: member.id }, data: { lastSignInAt: new Date() } })]);
  (await cookies()).set(SESSION_COOKIE, await sessionToken(email, secret, member.sessionVersion), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  redirect(safeNext(fd.get("next")));
}

/** Completes sign-in from an emailed link (a button press, so email scanners that open links can't use it up). */
export async function verifyLinkAction(token: string, next: string) {
  const secret = authSecret();
  const data = secret ? await verify<LinkToken>(token, secret) : null;
  const bad = (why: string) => redirect(`/login?e=${why}`);
  if (!secret || !data || data.kind !== "link") return bad("expired");
  const h = await headers();
  const { clientIp } = await import("@/lib/rate-limit");
  const record = (ok: boolean, reason?: string) =>
    db.signInEvent.create({ data: { email: data.email, ok, reason: reason ?? null, ip: clientIp(h).slice(0, 64), userAgent: (h.get("user-agent") ?? "").slice(0, 300) } }).catch(() => undefined);
  const member = await db.user.findUnique({ where: { email: data.email }, select: { id: true, status: true, sessionVersion: true, lastSignInAt: true } });
  if (!member || member.status !== "active") { await record(false, "access removed"); return bad("expired"); }
  if ((member.lastSignInAt?.getTime() ?? 0) !== data.last) { await record(false, "link already used"); return bad("used"); }
  await Promise.all([record(true, "email link"), db.user.update({ where: { id: member.id }, data: { lastSignInAt: new Date() } })]);
  (await cookies()).set(SESSION_COOKIE, await sessionToken(data.email, secret, member.sessionVersion), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  redirect(safeNext(next));
}

export async function signOutAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(MODE_COOKIE);
  redirect("/login");
}

/** Which client to work on ("all" = every client this person may see). Checked again on every query. */
export async function switchClientAction(id: string, to?: string | FormData) {
  const { CLIENT_COOKIE, clearScopeCache, resolveScope } = await import("@/lib/scope");
  const jar = await cookies();
  // Only an account this person is assigned to can be opened (every query also re-checks this).
  const scope = await resolveScope();
  if (id !== "all" && scope && !scope.choices.some((c) => c.id === id)) redirect("/clients?denied=1");
  if (id === "all") jar.delete(CLIENT_COOKIE);
  else jar.set(CLIENT_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86_400 });
  clearScopeCache();
  // A fresh request, so every number is read with the new client (not the one the page was drawn with).
  const { headers } = await import("next/headers");
  const ref = (await headers()).get("referer");
  let back = "/";
  try {
    if (ref) back = new URL(ref).pathname + new URL(ref).search;
  } catch {}
  // Opening an account from the Accounts page lands on its Home; switching elsewhere stays on the page.
  if (typeof to === "string" && to.startsWith("/") && !to.startsWith("//")) back = to;
  else if (back.startsWith("/clients")) back = "/";
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/");
}

/** Sri Krishna's switch: Super Admin on or off for this session. The entitlement itself never changes here. */
export async function switchModeAction(to: "super" | "user") {
  const me = await getMe();
  if (!me?.canSuperAdmin) return;
  const jar = await cookies();
  if (to === "super") jar.set(MODE_COOKIE, "super", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 8 * 3600 });
  else jar.delete(MODE_COOKIE);
  await audit(me.email, to === "super" ? "mode.super_admin" : "mode.user");
  redirect(to === "super" ? "/team" : "/");
}
