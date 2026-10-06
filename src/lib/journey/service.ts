// Journey persistence: every stage change goes through applyActivity and is written
// to the journey's timeline. Used by the CSV import, manual and bulk updates, and the
// agent-assisted reply flow.

import type { Journey, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAdapters } from "@/lib/adapters";
import { applyActivity, classifyReplyRules, nextAction, type Activity, type JourneyState } from "./engine";
import { JOURNEY_STAGES, STAGE_INFO, type Stage } from "./stages";

export type ActivitySource = "csv" | "manual" | "bulk" | "agent" | "system";

const toState = (j: Journey): JourneyState => ({ stage: j.stage as Stage, followUpCount: j.followUpCount, replyCount: j.replyCount, lastEngagementAt: j.lastEngagementAt, lastEngagement: j.lastEngagement });

/** One journey per person + campaign + sender; created on first use. */
export async function ensureJourney(contactId: string, campaignId: string, senderId: string, tx: Prisma.TransactionClient = db) {
  const existing = await tx.journey.findUnique({ where: { contactId_campaignId_senderId: { contactId, campaignId, senderId } } });
  if (existing) return { journey: existing, created: false };
  try {
    const journey = await tx.journey.create({ data: { contactId, campaignId, senderId } });
    return { journey, created: true };
  } catch {
    // Created concurrently by another chunk: use that one.
    return { journey: await tx.journey.findUniqueOrThrow({ where: { contactId_campaignId_senderId: { contactId, campaignId, senderId } } }), created: false };
  }
}

/** Apply activities in date order, write each to the timeline, save the journey. */
export async function recordActivities(journeyId: string, activities: Activity[], source: ActivitySource, extraDetail?: string) {
  const order: Record<Activity["type"], number> = { connection_sent: 0, connection_accepted: 1, follow_up_sent: 2, details_shared: 3, reply: 4, call_scheduled: 5, demo_scheduled: 6, call_logged: 7, note: 8, stage_set: 9 };
  const sorted = [...activities].sort((a, b) => a.at.getTime() - b.at.getTime() || order[a.type] - order[b.type]);
  return db.$transaction(async (tx) => {
    const j = await tx.journey.findUniqueOrThrow({ where: { id: journeyId } });
    let state = toState(j);
    const changes: { from: Stage; to: Stage }[] = [];
    for (const a of sorted) {
      const { next, event } = applyActivity(state, a);
      await tx.journeyEvent.create({
        data: {
          journeyId, type: event.type, fromStage: event.fromStage, toStage: event.toStage, source, occurredAt: event.occurredAt,
          detail: [event.detail, extraDetail].filter(Boolean).join(" · ") || null,
        },
      });
      if (event.fromStage !== event.toStage) changes.push({ from: event.fromStage, to: event.toStage });
      state = next;
    }
    const updated = await tx.journey.update({
      where: { id: journeyId },
      data: {
        stage: state.stage, followUpCount: state.followUpCount, replyCount: state.replyCount, lastEngagementAt: state.lastEngagementAt, lastEngagement: state.lastEngagement,
        stageReason: changes.length ? `${STAGE_INFO[changes[0].from].label} → ${STAGE_INFO[state.stage].label} (${source})` : j.stageReason,
      },
    });
    return { journey: updated, changed: changes.length > 0 || sorted.length > 0 };
  });
}

/** Suggested meaning of a pasted reply — the person confirms or changes it before it is saved. */
export async function suggestReplyMeaning(text: string, context: { company: string; title: string | null; stage: Stage }) {
  try {
    const s = await getAdapters().llm.classifyJourneyReply(text, context);
    if ((JOURNEY_STAGES as readonly string[]).includes(s.stage)) return { ...s, by: getAdapters().llm.model };
  } catch {
    // fall through to rules
  }
  const r = classifyReplyRules(text);
  return { stage: r.stage, reason: r.reason, nextAction: STAGE_INFO[r.stage].next, by: "rules" };
}

export function journeyView(j: Journey, now = new Date()) {
  const s = toState(j);
  return { ...s, next: nextAction(s, now) };
}
