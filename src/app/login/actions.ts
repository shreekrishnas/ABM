"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { MODE_COOKIE, audit, getMe } from "@/lib/me";
import { SESSION_COOKIE, SESSION_DAYS, allowedDomains, authSecret, domainAllowed, normalizeEmail, sessionToken } from "@/lib/auth";

export type LoginState = { email?: string; error?: string };

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
  const member = await db.user.findUnique({ where: { email }, select: { status: true } });
  if (!member || member.status !== "active") return { email, error: "You're not on the team yet. Ask a Super Admin to add you in Team & Access." };
  (await cookies()).set(SESSION_COOKIE, await sessionToken(email, secret), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  redirect(safeNext(fd.get("next")));
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
