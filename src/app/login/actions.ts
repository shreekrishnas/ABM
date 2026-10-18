"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  CODE_COOKIE, CODE_MINUTES_LEFT, MAX_CODE_TRIES, SESSION_COOKIE, SESSION_DAYS, allowedDomains, authSecret, codeExpiry, codeHash, domainAllowed, newCode, normalizeEmail, sessionToken, sign, verify, type PendingCode,
} from "@/lib/auth";

export type LoginState = { step: "email" | "code"; email?: string; error?: string; info?: string };

const secure = process.env.NODE_ENV === "production";
const safeNext = (n: FormDataEntryValue | null) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/");

async function startSession(email: string, secret: string, next: string): Promise<never> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sessionToken(email, secret), { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  jar.delete(CODE_COOKIE);
  redirect(next);
}

export async function requestCodeAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const secret = authSecret();
  if (!secret) return { step: "email", error: "Sign-in isn't set up yet: add AUTH_SECRET in Vercel." };
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  if (!email) return { step: "email", error: "Enter your work email address." };
  if (!domainAllowed(email)) return { step: "email", email, error: `Only @${allowedDomains().join(" or @")} addresses can sign in.` };
  const next = safeNext(fd.get("next"));

  const smtp = process.env.SMTP_URL?.trim();
  // No mailbox connected: the domain check is the only gate.
  if (!smtp) return startSession(email, secret, next);

  const code = newCode();
  const pending: PendingCode = { email, hash: await codeHash(code, email, secret), tries: 0, exp: codeExpiry() };
  try {
    const { SmtpSender } = await import("@/lib/adapters/live/email");
    const host = (await headers()).get("host") ?? "the app";
    await new SmtpSender(smtp, process.env.SMTP_FROM).send({
      from: process.env.SMTP_FROM || `no-reply@${allowedDomains()[0]}`,
      to: email,
      subject: `${code} is your sign-in code`,
      body: `Your sign-in code is ${code}\n\nIt works for ${CODE_MINUTES_LEFT} minutes on ${host}. If you didn't ask for it, ignore this email.`,
      idempotencyKey: `login-${Date.now()}`,
    });
  } catch {
    return { step: "email", email, error: "Couldn't send the code. Try again in a minute." };
  }
  (await cookies()).set(CODE_COOKIE, await sign(pending, secret), { httpOnly: true, secure, sameSite: "lax", path: "/login", maxAge: CODE_MINUTES_LEFT * 60 });
  return { step: "code", email, info: `We sent a 6-digit code to ${email}.` };
}

export async function verifyCodeAction(prev: LoginState, fd: FormData): Promise<LoginState> {
  const secret = authSecret();
  if (!secret) return { step: "email", error: "Sign-in isn't set up yet: add AUTH_SECRET in Vercel." };
  const jar = await cookies();
  const pending = await verify<PendingCode>(jar.get(CODE_COOKIE)?.value, secret);
  if (!pending) return { step: "email", email: prev.email, error: "That code expired. Request a new one." };
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  if (code.length === 6 && (await codeHash(code, pending.email, secret)) === pending.hash) return startSession(pending.email, secret, safeNext(fd.get("next")));
  const tries = pending.tries + 1;
  if (tries >= MAX_CODE_TRIES) {
    jar.delete(CODE_COOKIE);
    return { step: "email", email: pending.email, error: "Too many wrong codes. Request a new one." };
  }
  jar.set(CODE_COOKIE, await sign({ ...pending, tries }, secret), { httpOnly: true, secure, sameSite: "lax", path: "/login", maxAge: Math.max(1, Math.round((pending.exp - Date.now()) / 1000)) });
  return { step: "code", email: pending.email, error: `That code isn't right. ${MAX_CODE_TRIES - tries} tr${MAX_CODE_TRIES - tries === 1 ? "y" : "ies"} left.` };
}

export async function signOutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** One form, three intents: send a code, check a code, or start over with another email. */
export async function loginAction(prev: LoginState, fd: FormData): Promise<LoginState> {
  const intent = fd.get("intent");
  if (intent === "reset") {
    (await cookies()).delete(CODE_COOKIE);
    return { step: "email", email: prev.email };
  }
  return intent === "verify" ? verifyCodeAction(prev, fd) : requestCodeAction(prev, fd);
}
