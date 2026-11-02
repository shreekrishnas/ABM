"use server";

import { db } from "@/lib/db";
import { logAction, refresh } from "@/lib/action-utils";
import { JOURNEY_STAGES, type Stage } from "@/lib/journey/stages";
import { MESSAGE_KINDS, type MessageKind } from "@/lib/linkedin/types";
import type { ActionState } from "@/app/actions";

async function me() {
  const { getMe } = await import("@/lib/me");
  return (await getMe())?.email ?? null;
}

/** Scoped read = access check: the journey must belong to a person this user can see. */
async function journeyOf(journeyId: string) {
  const j = await db.journey.findUnique({ where: { id: journeyId }, select: { id: true, contactId: true } });
  if (!j) throw new Error("Conversation not found");
  return j;
}
async function messageOf(id: string) {
  const m = await db.linkedInMessage.findUnique({ where: { id }, select: { id: true, journeyId: true, contactId: true } });
  if (!m) throw new Error("Message not found");
  return m;
}
const done = (contactId: string, message: string, ok = true): ActionState => {
  refresh(`/people/${contactId}`);
  return { ok, message };
};
const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const dateOf = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "");
  const d = v ? new Date(`${v}T12:00:00Z`) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

export async function generateLinkedInAction(journeyId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const j = await journeyOf(journeyId);
    const kind = String(fd.get("kind") ?? "") as MessageKind;
    if (!MESSAGE_KINDS.includes(kind)) return { ok: false, message: "Choose a message type" };
    await logAction("linkedin.generate", { contactId: j.contactId, detail: kind });
    const { generateDraft } = await import("@/lib/linkedin/service");
    const m = await generateDraft(journeyId, kind, String(fd.get("note") ?? "").trim().slice(0, 300) || null, await me());
    return done(j.contactId, m.status === "blocked" ? "Draft written, but it failed a check: see below, then regenerate or edit" : "Draft ready: review, edit if needed, then copy it to LinkedIn");
  } catch (e) { return fail(e); }
}

export async function editLinkedInAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const m = await messageOf(id);
    const { editDraft } = await import("@/lib/linkedin/service");
    const r = await editDraft(id, String(fd.get("body") ?? "").trim(), await me());
    return done(m.contactId, r.status === "blocked" ? "Saved, but the edited text fails a check" : "Saved");
  } catch (e) { return fail(e); }
}

export async function approveLinkedInAction(id: string): Promise<ActionState> {
  try {
    const m = await messageOf(id);
    await logAction("linkedin.approve", { contactId: m.contactId });
    const { approveDraft } = await import("@/lib/linkedin/service");
    await approveDraft(id, await me());
    return done(m.contactId, "Approved: copy it to LinkedIn, then mark it as sent");
  } catch (e) { return fail(e); }
}

export async function discardLinkedInAction(id: string): Promise<ActionState> {
  try {
    const m = await messageOf(id);
    const { discardDraft } = await import("@/lib/linkedin/service");
    await discardDraft(id);
    return done(m.contactId, "Draft discarded");
  } catch (e) { return fail(e); }
}

export async function markSentLinkedInAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const m = await messageOf(id);
    await logAction("linkedin.sent", { contactId: m.contactId });
    const { recordSent } = await import("@/lib/linkedin/service");
    await recordSent(id, String(fd.get("sentText") ?? ""), dateOf(fd, "sentOn"), await me());
    return done(m.contactId, "Recorded as sent with the exact text; the journey is updated");
  } catch (e) { return fail(e); }
}

export async function recordLinkedInReplyAction(journeyId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const j = await journeyOf(journeyId);
    await logAction("linkedin.reply", { contactId: j.contactId });
    const { recordReply } = await import("@/lib/linkedin/service");
    await recordReply(journeyId, String(fd.get("reply") ?? "").slice(0, 4000), dateOf(fd, "receivedOn"), await me());
    return done(j.contactId, "Reply saved and read: check the meaning below and confirm it");
  } catch (e) { return fail(e); }
}

export async function confirmLinkedInReplyAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const m = await messageOf(id);
    const stage = String(fd.get("stage") ?? "") as Stage;
    if (!(JOURNEY_STAGES as readonly string[]).includes(stage)) return { ok: false, message: "Choose what the reply means" };
    await logAction("linkedin.reply_confirm", { contactId: m.contactId, detail: stage });
    const { confirmReply } = await import("@/lib/linkedin/service");
    await confirmReply(id, stage, await me());
    return done(m.contactId, "Confirmed: the journey and the next step are updated");
  } catch (e) { return fail(e); }
}

export async function upToDateLinkedInAction(journeyId: string): Promise<ActionState> {
  try {
    const j = await journeyOf(journeyId);
    const { confirmUpToDate } = await import("@/lib/linkedin/service");
    await confirmUpToDate(journeyId);
    return done(j.contactId, "Noted: the conversation is up to date as of now");
  } catch (e) { return fail(e); }
}

export async function correctSummaryAction(journeyId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const j = await journeyOf(journeyId);
    const who = (await me()) ?? "a team member";
    const list = (k: string) => String(fd.get(k) ?? "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8);
    const nd = String(fd.get("nextDate") ?? "");
    const { correctSummary } = await import("@/lib/linkedin/service");
    await correctSummary(journeyId, { stage: String(fd.get("stage") ?? "").slice(0, 80), lastInteraction: String(fd.get("lastInteraction") ?? "").slice(0, 300), topics: list("topics"), concerns: list("concerns"), interest: String(fd.get("interest") ?? "").slice(0, 200), commitments: list("commitments"), nextStep: String(fd.get("nextStep") ?? "").slice(0, 300), nextDate: /^\d{4}-\d{2}-\d{2}$/.test(nd) ? nd : null }, who);
    await logAction("linkedin.summary_correct", { contactId: j.contactId });
    return done(j.contactId, "Summary corrected; your version is kept until the next reply");
  } catch (e) { return fail(e); }
}

export async function refreshSummaryAction(journeyId: string): Promise<ActionState> {
  try {
    const j = await journeyOf(journeyId);
    const { refreshSummary } = await import("@/lib/linkedin/service");
    const s = await refreshSummary(journeyId, true);
    return done(j.contactId, s ? "Summary rebuilt from the recorded messages" : "Nothing recorded yet to summarise", Boolean(s));
  } catch (e) { return fail(e); }
}
