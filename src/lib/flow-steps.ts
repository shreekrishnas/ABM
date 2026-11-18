// The company-flow steps (imported, qualified ... opportunity) as Prisma conditions. Shared by the
// Command Center counts and the Companies list's ?flow= filter, so both count the same companies.
// No database import here: the filters module is used on both sides.
import type { Prisma } from "@prisma/client";

export const live = { mergedIntoId: null };
const engagedContact = { OR: [{ state: { in: ["replied", "handed_off"] as ("replied" | "handed_off")[] } }, { signals: { some: { attributed: true } } }, { journeys: { some: { stage: { in: ["replied_neutral", "details_requested", "details_shared", "interested", "call_scheduled", "demo_scheduled", "opportunity", "closed_won"] as never[] } } } }] };

// Funnel steps are nested: each counts companies that also passed every step before it.
export const FLOW_STEPS = [
  { key: "imported", where: {} },
  { key: "qualified", where: { pipelineStage: { gte: 4 }, stage: { not: "DISQUALIFIED" as const } } },
  { key: "researched", where: { briefs: { some: {} } } },
  { key: "contactable", where: { contacts: { some: { mergedIntoId: null, state: { in: ["ready", "in_sequence", "replied", "handed_off"] as ("ready" | "in_sequence" | "replied" | "handed_off")[] } } } } },
  { key: "contacted", where: { contacts: { some: { OR: [{ messages: { some: { status: "delivered" as const } } }, { journeys: { some: { stage: { not: "not_contacted" as const } } } }] } } } },
  { key: "engaged", where: { contacts: { some: engagedContact } } },
  { key: "handoff", where: { handoffs: { some: {} } } },
  { key: "opportunity", where: { opportunities: { some: {} } } },
];

export type FlowKey = (typeof FLOW_STEPS)[number]["key"];

/** Companies that reached a step: every step up to and including it (the steps are nested). */
export function flowStepWhere(key: string): Prisma.AccountWhereInput | null {
  const i = FLOW_STEPS.findIndex((s) => s.key === key);
  return i < 0 ? null : ({ AND: FLOW_STEPS.slice(0, i + 1).map((s) => s.where) } as Prisma.AccountWhereInput);
}
