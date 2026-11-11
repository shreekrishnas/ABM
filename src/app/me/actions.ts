"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getMe } from "@/lib/me";
import { HOMES, NOTICE_KINDS, prefsFor, type NoticeKind } from "@/lib/prefs";
import { SESSION_COOKIE, SESSION_DAYS, authSecret, sessionToken } from "@/lib/auth";

type R = { ok: boolean; message: string };

export async function saveMyProfileAction(_: R | null, fd: FormData): Promise<R> {
  const me = await getMe();
  if (!me) return { ok: false, message: "Sign in first" };
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, message: "Enter your name" };
  const home = String(fd.get("home") ?? "/");
  const mute = NOTICE_KINDS.map((k) => k.key).filter((k) => fd.get(`n_${k}`) !== "on") as NoticeKind[];
  const prefs = { ...(await prefsFor(me.email)), home: HOMES.some((h) => h.value === home) ? home : "/", mute };
  await db.user.update({ where: { id: me.id }, data: { name, prefs: prefs as unknown as Prisma.InputJsonValue } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

export async function dismissHintAction(key: string): Promise<void> {
  const me = await getMe();
  if (!me) return;
  const p = await prefsFor(me.email);
  const dismissed = [...new Set([...(p.dismissed ?? []), key.slice(0, 40)])];
  await db.user.update({ where: { id: me.id }, data: { prefs: { ...p, dismissed } as unknown as Prisma.InputJsonValue } });
  revalidatePath("/");
}

/** Sign out every other device; this one stays signed in. */
export async function signOutOtherDevicesAction(): Promise<R> {
  const me = await getMe();
  const secret = authSecret();
  if (!me || !secret) return { ok: false, message: "Sign in first" };
  const u = await db.user.update({ where: { id: me.id }, data: { sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
  (await cookies()).set(SESSION_COOKIE, await sessionToken(me.email, secret, u.sessionVersion), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  return { ok: true, message: "Signed out everywhere else. This device stays signed in." };
}
