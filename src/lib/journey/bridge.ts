// LinkedIn → email bridge. LinkedIn stays manual: a team member logs what happened. When a
// logged LinkedIn step means a real conversation (or a no), the email side reacts the same
// way an email reply would, so nobody gets a cold email in the middle of a LinkedIn chat.
//
//   interested / call / demo / opportunity → pause this person's email, positive signal, hand-off
//   replied / asked for details / nurture  → pause this person's email (continue on LinkedIn)
//   not interested / disqualified          → stop this person's email
//   referred                               → pause, task to add the referred colleague
//
// Imported history (CSV) only pauses: it never starts a hand-off on its own.

import { db } from "@/lib/db";
import { newContext, logEvent } from "@/lib/pipeline/context";
import type { Stage } from "./stages";
import { STAGE_INFO } from "./stages";

const POSITIVE: readonly Stage[] = ["interested", "call_scheduled", "demo_scheduled", "opportunity", "closed_won"];
const CONVERSATION: readonly Stage[] = ["replied_neutral", "details_requested", "details_shared", "nurture"];
const STOP: readonly Stage[] = ["not_interested", "disqualified", "closed_lost"];

export async function bridgeLinkedInToEmail(journeyId: string, from: Stage, to: Stage, source: string) {
  if (from === to) return null;
  const kind = POSITIVE.includes(to) ? "positive" : CONVERSATION.includes(to) ? "conversation" : STOP.includes(to) ? "stop" : to === "referred" ? "referred" : null;
  if (!kind) return null;
  const j = await db.journey.findUniqueOrThrow({ where: { id: journeyId }, include: { contact: { include: { account: true } }, sender: true } });
  const c = j.contact;
  const ctx = newContext();
  const why = `LinkedIn (${j.sender.name}): ${c.fullName} ${STAGE_INFO[to].phrase}`;

  // This person's automated email waits; unsent drafts are withdrawn so nothing goes out mid-conversation.
  await db.enrollment.updateMany({ where: { contactId: c.id, status: "active" }, data: { status: kind === "stop" ? "stopped" : "paused", pausedReason: `linkedin: ${STAGE_INFO[to].label}` } });
  const withdrawn = await db.draft.updateMany({ where: { contactId: c.id, status: { in: ["pending_review", "approved"] }, message: null }, data: { status: "rejected", reviewerNote: `Withdrawn — ${why}` } });
  if (!["handed_off", "suppressed", "do_not_contact"].includes(c.state)) {
    await db.contact.update({ where: { id: c.id }, data: { state: kind === "stop" && to === "disqualified" ? "do_not_contact" : kind === "positive" ? "replied" : "paused" } });
  }
  await logEvent(ctx, { accountId: c.accountId, contactId: c.id, stage: 12, step: "linkedin.bridge", outcome: kind === "positive" ? "pass" : "info", reason: `${why} — email ${kind === "stop" ? "stopped" : "paused"} for this person${withdrawn.count ? `, ${withdrawn.count} unsent draft(s) withdrawn` : ""} (logged ${source})` });

  if (kind === "referred") {
    await db.task.create({ data: { title: `Add the colleague ${c.fullName} referred us to`, body: `${why}. Create or link the referred contact, then let the plan pick them up.`, accountId: c.accountId, contactId: c.id, assigneeId: c.account.ownerId, origin: "reply", dueAt: ctx.now } });
  }
  if (kind === "positive" && source !== "csv") {
    const { recordSignal, s13Handoff } = await import("@/lib/pipeline/stages/engagement");
    await recordSignal({ accountId: c.accountId, contactId: c.id, type: "email_reply", source: "linkedin_manual", detail: `positive (LinkedIn: ${STAGE_INFO[to].label})` }, ctx);
    const open = await db.handoff.findFirst({ where: { accountId: c.accountId, acknowledgedAt: null, status: "open" } });
    if (!open) await s13Handoff(await db.account.findUniqueOrThrow({ where: { id: c.accountId } }), "positive_reply", ctx);
  }
  return kind;
}
