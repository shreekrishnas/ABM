"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, allowedDomains, authSecret, domainAllowed, normalizeEmail, sessionToken } from "@/lib/auth";

export type LoginState = { email?: string; error?: string };

const safeNext = (n: FormDataEntryValue | null) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/");

/** Sign in with a work email: only addresses on the allowed domain get in. */
export async function loginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const secret = authSecret();
  if (!secret) return { error: "Sign-in isn't set up yet: add AUTH_SECRET in Vercel." };
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  if (!email) return { error: "Enter your work email address." };
  if (!domainAllowed(email)) return { email, error: `Only @${allowedDomains().join(" or @")} addresses can sign in.` };
  (await cookies()).set(SESSION_COOKIE, await sessionToken(email, secret), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  redirect(safeNext(fd.get("next")));
}

export async function signOutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
