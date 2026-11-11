"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { baseDb } from "@/lib/db-base"; // Start fresh clears every client, whichever one is picked
import { allowedDomains, domainAllowed, normalizeEmail } from "@/lib/auth";
import { audit, requireSuperAdmin } from "@/lib/me";
import type { ActionState } from "../actions";
import type { Prisma } from "@prisma/client";
import { starterPack } from "@/lib/seller/brain";
import { logoFromInput } from "@/lib/logo";
import { headers } from "next/headers";
import { kickDrain } from "@/lib/queue/drain";
import { hashPack } from "@/lib/seller";

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
  (await import("@/lib/scope")).clearScopeCache();
  try {
    const me = await requireSuperAdmin();
    const [user, client] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: userId } }), db.client.findUniqueOrThrow({ where: { id: clientId } })]);
    if (assigned) await db.userClient.upsert({ where: { userId_clientId: { userId, clientId } }, create: { userId, clientId, role: "rep" }, update: {} });
    else await db.userClient.deleteMany({ where: { userId, clientId } });
    await audit(me.email, assigned ? "assignment.add" : "assignment.remove", { target: user.email, clientId, before: { assigned: !assigned }, after: { assigned } });
    revalidatePath("/team");
    return { ok: true, message: assigned ? `${user.name} now works on ${client.name}` : `${user.name} no longer sees ${client.name}` };
  } catch (e) {
    return fail(e);
  }
}

export async function addClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId = "";
  try {
    const me = await requireSuperAdmin();
    const name = text(fd, "name");
    if (!name || name.length > 80) return { ok: false, message: "Enter the account name" };
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!id) return { ok: false, message: "Use letters or numbers in the name" };
    if (await db.client.findUnique({ where: { id } })) return { ok: false, message: `${name} already exists` };
    const logo = logoFromInput(text(fd, "logo") ?? "");
    if ("error" in logo) return { ok: false, message: logo.error };
    const userIds = fd.getAll("users").filter((v): v is string => typeof v === "string");
    const people = await db.user.findMany({ where: { id: { in: userIds }, status: "active" }, select: { id: true, email: true, name: true } });
    await db.client.create({ data: { id, name, logoUrl: logo.url, users: { create: people.map((u) => ({ userId: u.id })) } } });
    // A blank brain to fill in; research waits until it is complete.
    const pack = starterPack(id, name);
    await db.sellerPackRevision.create({ data: { sellerId: id, pack: pack as unknown as Prisma.InputJsonValue, version: hashPack(pack), changed: ["created"], note: `Created by ${me.email}` } });
    await audit(me.email, "client.add", { target: name, clientId: id, after: { id, name, assigned: people.map((u) => u.email) } });
    revalidatePath("/team");
    newId = id;
  } catch (e) {
    return fail(e);
  }
  // Straight to the new client's settings page, where the setup checklist says what to do next.
  const { redirect } = await import("next/navigation");
  redirect(`/team/client/${newId}?new=1`);
  return { ok: true, message: "" };
}

/** Super Admin: set or clear an account's logo (an image link or the website). */
export async function setClientLogoAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const client = await db.client.findUnique({ where: { id: clientId } });
    if (!client) return { ok: false, message: "That account no longer exists" };
    const logo = logoFromInput(text(fd, "logo") ?? "");
    if ("error" in logo) return { ok: false, message: logo.error };
    await db.client.update({ where: { id: clientId }, data: { logoUrl: logo.url } });
    await audit(me.email, "client.logo", { target: client.name, clientId, before: { logoUrl: client.logoUrl }, after: { logoUrl: logo.url } });
    revalidatePath("/team");
    revalidatePath("/clients");
    return { ok: true, message: logo.url ? `${client.name} logo updated` : `${client.name} logo removed` };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Super Admin: remove all company data to start fresh with real data. Keeps the team, clients,
 * assignments, Account Brain (seller packs + knowledge files), sequences and the audit log.
 * Removes companies (and everything attached to them), imports, suggestions, visits, mailboxes,
 * suppressions, insights, brain logs and demo (@company.com) logins.
 */
export async function clearWorkspaceDataAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    if (text(fd, "confirm").toLowerCase() !== "delete everything") return { ok: false, message: 'Type "delete everything" to confirm' };
    const before = await baseDb.account.count();
    const [accounts] = await baseDb.$transaction([
      baseDb.account.deleteMany({}),
      baseDb.importBatch.deleteMany({}),
      baseDb.prospectSuggestion.deleteMany({}),
      baseDb.webVisit.deleteMany({}),
      baseDb.marketEvent.deleteMany({}),
      baseDb.mailbox.deleteMany({}),
      baseDb.suppression.deleteMany({}),
      baseDb.brainInsight.deleteMany({}),
      baseDb.brainSignal.deleteMany({}),
      baseDb.decision.deleteMany({}),
      baseDb.proposal.deleteMany({}),
      baseDb.user.deleteMany({ where: { email: { endsWith: "@company.com" } } }),
    ]);
    await audit(me.email, "data.clear", { before: { companies: before }, after: { companies: 0 } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Removed ${accounts.count} companies and everything attached. Team, clients, Account Brain and sequences kept.` };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Super Admin: remove one account's company data only (companies and everything attached,
 * imports, suggestions, market events, signals, decisions, proposals). Its team, brain,
 * knowledge files and every other account are untouched. The account's name must be typed.
 */
export async function clearAccountDataAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const client = await baseDb.client.findUnique({ where: { id: clientId } });
    if (!client) return { ok: false, message: "That account no longer exists" };
    if (text(fd, "confirm").toLowerCase() !== client.name.toLowerCase()) return { ok: false, message: `Type the account name (${client.name}) to confirm` };
    const own = { sellerId: clientId };
    const ids = (await baseDb.account.findMany({ where: own, select: { id: true } })).map((a) => a.id);
    const [, accounts] = await baseDb.$transaction([
      baseDb.webVisit.deleteMany({ where: { accountId: { in: ids } } }),
      baseDb.account.deleteMany({ where: own }),
      baseDb.importBatch.deleteMany({ where: own }),
      baseDb.prospectSuggestion.deleteMany({ where: own }),
      baseDb.marketEvent.deleteMany({ where: own }),
      baseDb.brainSignal.deleteMany({ where: own }),
      baseDb.decision.deleteMany({ where: own }),
      baseDb.proposal.deleteMany({ where: own }),
    ]);
    await audit(me.email, "data.clear_account", { target: client.name, clientId, before: { companies: ids.length }, after: { companies: 0 } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Removed ${accounts.count} companies from ${client.name}. Its team, brain and the other accounts are untouched.` };
  } catch (e) {
    return fail(e);
  }
}

/** Super Admin: restart the background queue (when it has stopped). */
export async function restartQueueAction(): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const origin = host ? `${h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https")}://${host}` : null;
    const started = await kickDrain(origin);
    await audit(me.email, "queue.restart", { after: { started } });
    revalidatePath("/team");
    return { ok: started, message: started ? "Background queue restarted" : "Couldn't reach the queue. Check APP_URL and ABM_API_KEY in Vercel" };
  } catch (e) {
    return fail(e);
  }
}

/** Super Admin: set or clear an account's monthly spending cap (dollars). */
export async function setMonthlyBudgetAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const client = await baseDb.client.findUnique({ where: { id: clientId } });
    if (!client) return { ok: false, message: "That account no longer exists" };
    const raw = text(fd, "budget").replace(/[$,\s]/g, "");
    const value = raw === "" ? null : Number(raw);
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) return { ok: false, message: "Enter a dollar amount, or leave it empty for no cap" };
    const cap = value == null ? null : Math.round(value);
    await baseDb.client.update({ where: { id: clientId }, data: { monthlyBudgetUsd: cap } });
    await audit(me.email, "client.budget", { target: client.name, clientId, before: { monthlyBudgetUsd: client.monthlyBudgetUsd }, after: { monthlyBudgetUsd: cap } });
    revalidatePath("/team");
    return { ok: true, message: cap == null ? `${client.name}: no monthly cap` : `${client.name}: monthly cap $${cap.toLocaleString()}` };
  } catch (e) {
    return fail(e);
  }
}

/** Super Admin: clear the error log after reviewing it. */
export async function clearErrorsAction(): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { clearErrors } = await import("@/lib/admin/errors");
    await clearErrors();
    await audit(me.email, "errors.clear");
    revalidatePath("/team");
    return { ok: true, message: "Error log cleared" };
  } catch (e) {
    return fail(e);
  }
}

/** Super Admin: close identity items that were only about the email domain (older rule). */
export async function clearEmailConflictsAction(): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { clearEmailOnlyConflicts } = await import("@/lib/admin/cleanup");
    const r = await clearEmailOnlyConflicts();
    await audit(me.email, "data.email_conflicts", { after: r });
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.reviews} "Is this the right person?" item${r.reviews === 1 ? "" : "s"} closed · ${r.emails} email${r.emails === 1 ? "" : "s"} accepted` };
  } catch (e) {
    return fail(e);
  }
}

/** Pause or resume all AI (OpenRouter) spending. */
export async function setAiPausedAction(paused: boolean): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { setAiPaused } = await import("@/lib/admin/ai-pause");
    if (!paused) {
      // Never resume spending without a ceiling on every client.
      const uncapped = await baseDb.client.findMany({ where: { monthlyBudgetUsd: null }, select: { name: true } });
      if (uncapped.length) return { ok: false, message: `Set a monthly cap first for: ${uncapped.map((c) => c.name).join(", ")} (Super Admin → Clients)` };
    }
    await setAiPaused(paused, me.email);
    await audit(me.email, paused ? "ai.pause" : "ai.resume");
    if (!paused) {
      const h = await headers();
      const host = h.get("x-forwarded-host") ?? h.get("host");
      await kickDrain(host ? `${h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https")}://${host}` : null).catch(() => undefined);
    }
    revalidatePath("/team");
    return { ok: true, message: paused ? "AI paused: no OpenRouter spending until you resume" : "AI resumed: the queue picks up where it stopped" };
  } catch (e) {
    return fail(e);
  }
}

export async function setRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { isRole, ROLE_LABEL } = await import("@/lib/roles");
    const userId = String(fd.get("userId") ?? ""), clientId = String(fd.get("clientId") ?? ""), role = fd.get("role");
    if (!isRole(role)) return { ok: false, message: "Pick a role" };
    const row = await db.userClient.findUnique({ where: { userId_clientId: { userId, clientId } }, include: { user: true, client: true } });
    if (!row) return { ok: false, message: "Assign them to this client first" };
    await db.userClient.update({ where: { userId_clientId: { userId, clientId } }, data: { role } });
    (await import("@/lib/scope")).clearScopeCache();
    await audit(me.email, "assignment.role", { target: row.user.email, clientId, before: { role: row.role }, after: { role } });
    revalidatePath("/team");
    return { ok: true, message: `${row.user.name} is now ${ROLE_LABEL[role]} in ${row.client.name}` };
  } catch (e) {
    return fail(e);
  }
}

export async function signOutEverywhereAction(userId: string): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const u = await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    await audit(me.email, "user.sign_out_everywhere", { target: u.email });
    revalidatePath("/team");
    return { ok: true, message: `${u.name} is signed out on every device` };
  } catch (e) {
    return fail(e);
  }
}

/** Sends one real email to the signed-in Super Admin, to prove sending works before any prospect is emailed. */
export async function sendTestEmailAction(): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const url = process.env.SMTP_URL?.trim();
    if (!url) return { ok: false, message: "Email sending is not connected yet: add SMTP_URL (and SMTP_FROM) in Vercel, then redeploy" };
    const { SmtpSender } = await import("@/lib/adapters/live/email");
    const from = process.env.SMTP_FROM?.trim() || me.email;
    await new SmtpSender(url, from).send({ from, to: me.email, subject: "ABM test email", body: "This is a test from your ABM workspace. If you can read it, email sending works.", idempotencyKey: `test-${Date.now()}` });
    await audit(me.email, "email.test", { target: me.email });
    return { ok: true, message: `Test email sent to ${me.email}. Check the inbox (and spam).` };
  } catch (e) {
    return { ok: false, message: `The mailbox refused the test: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}` };
  }
}

export async function setShowExtrasAction(clientId: string, on: boolean): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const c = await baseDb.client.update({ where: { id: clientId }, data: { showExtras: on } });
    await audit(me.email, "client.extras", { target: c.name, clientId, after: { showExtras: on } });
    revalidatePath("/", "layout");
    return { ok: true, message: on ? `${c.name}: extra pages are shown` : `${c.name}: menu shows the core pages only` };
  } catch (e) {
    return fail(e);
  }
}

/** Loads the Test client one short step at a time; the page keeps calling until done. */
export async function sampleStepAction(): Promise<{ ok: boolean; done: boolean; message: string }> {
  try {
    const me = await requireSuperAdmin();
    const { sampleStep } = await import("@/lib/sample");
    const r = await sampleStep(me.email);
    if (r.done) {
      await audit(me.email, "sample.load", { target: "Test (sample data)" });
      (await import("@/lib/scope")).clearScopeCache();
      revalidatePath("/", "layout");
    }
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, done: true, message: e instanceof Error ? e.message.slice(0, 200) : "Something went wrong" };
  }
}

export async function removeSampleAction(): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { removeSample } = await import("@/lib/sample");
    const n = await removeSample();
    await audit(me.email, "sample.remove", { target: "Test (sample data)", before: { companies: n } });
    (await import("@/lib/scope")).clearScopeCache();
    revalidatePath("/", "layout");
    return { ok: true, message: `Removed the Test client and its ${n} sample companies. Nothing else was touched.` };
  } catch (e) {
    return fail(e);
  }
}

export async function resolveErrorAction(id: string): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { resolveError } = await import("@/lib/admin/errors");
    await resolveError(id);
    await audit(me.email, "errors.resolve", { target: id });
    revalidatePath("/team");
    return { ok: true, message: "Marked resolved. It comes back here if it happens again." };
  } catch (e) {
    return fail(e);
  }
}

/** Puts every stopped company in one group (same client, same reason) back in the queue, from the step it stopped at. */
export async function retryStoppedAction(clientId: string, key: string): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { stoppedIds } = await import("@/lib/admin/ops");
    const rows = await stoppedIds(clientId, key);
    if (!rows.length) return { ok: false, message: "Nothing to retry: these companies have moved on already" };
    for (const a of rows) await baseDb.account.update({ where: { id: a.id }, data: { pipelineStatus: "queued", queuedFromStage: Math.max(2, a.pipelineStage + 1), nextRetryAt: null, retryCount: 0, lastError: null } });
    const client = await baseDb.client.findUnique({ where: { id: clientId }, select: { name: true } });
    await audit(me.email, "companies.retry_stopped", { target: `${client?.name ?? clientId}: ${key}`, clientId, after: { companies: rows.length } });
    const { aiPause } = await import("@/lib/admin/ai-pause");
    const paused = await aiPause();
    if (!paused) {
      const { startBackgroundQueue } = await import("@/lib/action-utils");
      await startBackgroundQueue().catch(() => undefined);
    }
    revalidatePath("/team");
    return { ok: true, message: `${rows.length} compan${rows.length === 1 ? "y" : "ies"} queued again${paused ? ". AI is paused, so they wait until you resume it." : "."}` };
  } catch (e) {
    return fail(e);
  }
}

export async function renameClientAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const name = text(fd, "name");
    if (!name || name.length > 80) return { ok: false, message: "Enter a name (up to 80 characters)" };
    const before = await baseDb.client.findUnique({ where: { id: clientId }, select: { name: true } });
    if (!before) return { ok: false, message: "That client no longer exists" };
    await baseDb.client.update({ where: { id: clientId }, data: { name } });
    await audit(me.email, "client.rename", { target: name, clientId, before: { name: before.name }, after: { name } });
    (await import("@/lib/scope")).clearScopeCache();
    revalidatePath("/", "layout");
    return { ok: true, message: `Renamed to ${name}` };
  } catch (e) {
    return fail(e);
  }
}

/** Active, paused (research and sending stop) or archived (also hidden from team members' menus). Nothing is deleted. */
export async function setClientStatusAction(clientId: string, status: "active" | "paused" | "archived"): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const { isClientStatus, forgetClientStatus } = await import("@/lib/admin/client-status");
    if (!isClientStatus(status)) return { ok: false, message: "Unknown status" };
    const before = await baseDb.client.findUnique({ where: { id: clientId }, select: { name: true, status: true } });
    if (!before) return { ok: false, message: "That client no longer exists" };
    await baseDb.client.update({ where: { id: clientId }, data: { status } });
    forgetClientStatus();
    (await import("@/lib/scope")).clearScopeCache();
    await audit(me.email, `client.${status === "active" ? "resume" : status}`, { target: before.name, clientId, before: { status: before.status }, after: { status } });
    revalidatePath("/", "layout");
    const what = status === "active" ? "is active again: queued research and approved emails carry on" : status === "paused" ? "is paused: research and sending stop for it; everything stays readable" : "is archived: work stops and it leaves team members' client menus. Restore it any time";
    return { ok: true, message: `${before.name} ${what}` };
  } catch (e) {
    return fail(e);
  }
}

/** Emergency: every active person must sign in again on every device. */
export async function signOutAllAction(): Promise<ActionState> {
  try {
    const me = await requireSuperAdmin();
    const r = await baseDb.user.updateMany({ where: { status: "active" }, data: { sessionVersion: { increment: 1 } } });
    await audit(me.email, "security.sign_out_all", { after: { people: r.count } });
    const { redirect } = await import("next/navigation");
    redirect("/login");
  } catch (e) {
    const { isRedirectError } = await import("next/dist/client/components/redirect-error");
    if (isRedirectError(e)) throw e;
    return fail(e);
  }
  return { ok: true, message: "" };
}
