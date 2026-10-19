"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { allowedDomains, domainAllowed, normalizeEmail } from "@/lib/auth";
import { audit, requireSuperAdmin } from "@/lib/me";
import type { ActionState } from "../actions";

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function addUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const name = text(fd, "name");
    const email = normalizeEmail(text(fd, "email"));
    if (!name || name.length > 120) return { ok: false, message: "Enter the person's name" };
    if (!email || !domainAllowed(email)) return { ok: false, message: `Use an @${allowedDomains()[0]} address` };
    const existing = await db.user.findUnique({ where: { email } });
    if (existing?.status === "active") return { ok: false, message: `${email} is already on the team` };
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data: { name, status: "active" } })
      : await db.user.create({ data: { name, email, role: "rep" } });
    await audit(me.email, existing ? "user.restore" : "user.add", { target: email, before: existing ? { status: existing.status } : undefined, after: { name, status: "active" } });
    revalidatePath("/team");
    return { ok: true, message: `${user.name} can now sign in` };
  } catch (e) {
    return fail(e);
  }
}

export async function setUserStatusAction(userId: string, status: "active" | "removed"): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email === me.email) return { ok: false, message: "You can't remove yourself" };
    await db.user.update({ where: { id: userId }, data: { status } });
    await audit(me.email, status === "removed" ? "user.remove" : "user.restore", { target: user.email, before: { status: user.status }, after: { status } });
    revalidatePath("/team");
    return { ok: true, message: status === "removed" ? `${user.name} can no longer sign in` : `${user.name} can sign in again` };
  } catch (e) {
    return fail(e);
  }
}

export async function setAssignmentAction(userId: string, clientId: string, assigned: boolean): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const [user, client] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: userId } }), db.client.findUniqueOrThrow({ where: { id: clientId } })]);
    if (assigned) await db.userClient.upsert({ where: { userId_clientId: { userId, clientId } }, create: { userId, clientId }, update: {} });
    else await db.userClient.deleteMany({ where: { userId, clientId } });
    await audit(me.email, assigned ? "assignment.add" : "assignment.remove", { target: user.email, clientId, before: { assigned: !assigned }, after: { assigned } });
    revalidatePath("/team");
    return { ok: true, message: assigned ? `${user.name} now works on ${client.name}` : `${user.name} no longer sees ${client.name}` };
  } catch (e) {
    return fail(e);
  }
}

export async function addClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const name = text(fd, "name");
    if (!name || name.length > 80) return { ok: false, message: "Enter the client's name" };
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!id) return { ok: false, message: "Use letters or numbers in the name" };
    if (await db.client.findUnique({ where: { id } })) return { ok: false, message: `${name} already exists` };
    await db.client.create({ data: { id, name } });
    await audit(me.email, "client.add", { target: name, clientId: id, after: { id, name } });
    revalidatePath("/team");
    return { ok: true, message: `${name} added. Assign people to it below.` };
  } catch (e) {
    return fail(e);
  }
}
