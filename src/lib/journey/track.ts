// Prospect track: one person's whole journey with us, from the moment they entered
// the system to today — data checks, research, the brain's decisions, every email
// version, LinkedIn activity, replies, engagement and hand-offs — in one timeline.

import { db } from "@/lib/db";
import { STAGE_INFO } from "./stages";

export type TrackKind = "data" | "brain" | "email" | "linkedin" | "engagement" | "people";
export type TrackTone = "good" | "bad" | "info" | "wait";

export interface TrackItem {
  at: Date;
  kind: TrackKind;
  tone: TrackTone;
  title: string;
  detail?: string | null;
  /** Who or what did it: import, brain module, sender profile, reviewer… */
  by?: string | null;
  href?: string | null;
}

/** Milestones in order; the stepper shows how far this person has come. */
export const MILESTONES = ["Added", "Verified", "Selected", "Ready", "Drafted", "Contacted", "Engaged", "Meeting", "Opportunity"] as const;
export type Milestone = (typeof MILESTONES)[number];

const STEP_LABEL: Record<string, string> = {
  "identity.current_role_check": "Role and company checked",
  "identity.identity_confidence": "Identity confidence scored",
  "identity.email_domain_match": "Email domain matched to the company",
  "identity.focused_recheck": "Identity re-checked with a second source",
  "identity.freshness_check": "Title freshness checked",
  "buying_group.affected_function": "Owning function identified",
  "buying_group.discover_by_function": "Buying group searched",
  "buying_group.select": "Selected for the buying group",
  "enrichment.paid_lookup": "Email looked up",
  "enrichment.skip_paid_lookup": "Email from import used",
  "enrichment.mailbox_verification": "Email checked",
  "enrichment.suppression_check": "Opt-out list checked",
  "enrichment.lawful_basis": "Lawful basis recorded",
  "readiness.decide": "Readiness decided",
  "draft_review.choose_evidence": "Opening chosen",
  "draft_review.fact_guardrail": "Claims checked against facts",
  "draft_review.claim_check": "Claims checked against source quotes",
  "draft_review.critic_panel": "Critic panel reviewed the email",
  "draft_review.compliance": "Compliance checked",
  "draft_review.human_review": "Email ready",
  "sequence_send.pre_send_checks": "Pre-send checks",
  "sequence_send.send_once": "Email sent",
  "sequence_send.channel": "Waiting for a mailbox",
};

const LI_LABEL: Record<string, string> = {
  connection_sent: "LinkedIn connection request sent", connection_accepted: "Accepted the LinkedIn connection", follow_up_sent: "LinkedIn follow-up sent", reply: "Replied on LinkedIn",
  details_shared: "Details shared", call_scheduled: "Call scheduled", demo_scheduled: "Demo scheduled", call_logged: "Call made", stage_set: "Stage changed", note: "Note", imported: "LinkedIn history imported",
};

const tone = (o: string): TrackTone => (o === "pass" ? "good" : o === "block" ? "wait" : o === "error" ? "bad" : "info");

export async function prospectTrack(contactId: string) {
  const c = await db.contact.findUniqueOrThrow({
    where: { id: contactId },
    include: {
      account: { select: { id: true, name: true, tier: true, fitScore: true } },
      journeys: { include: { sender: { select: { name: true } }, campaign: { select: { name: true } }, events: { orderBy: { occurredAt: "asc" } } } },
      drafts: { include: { message: { include: { replies: true } } }, orderBy: { createdAt: "asc" } },
      replies: { orderBy: { receivedAt: "asc" } },
    },
  });
  const [events, decisions, signals, reviews] = await Promise.all([
    db.pipelineEvent.findMany({ where: { contactId }, orderBy: { createdAt: "asc" }, take: 400 }),
    db.decision.findMany({ where: { contactId }, orderBy: { createdAt: "asc" } }),
    db.signal.findMany({ where: { contactId }, orderBy: { occurredAt: "asc" } }),
    db.reviewItem.findMany({ where: { contactId }, orderBy: { createdAt: "asc" } }),
  ]);

  const items: TrackItem[] = [];
  items.push({ at: c.createdAt, kind: "people", tone: "info", title: `Added to ${c.account.name}`, detail: `${c.title ?? "No title"} · from ${c.source}`, by: c.source });

  // Data checks and brain steps that concern this person (collapsed: one row per step and outcome per day).
  const seen = new Set<string>();
  for (const e of events) {
    const k = `${e.step}|${e.outcome}|${e.createdAt.toISOString().slice(0, 10)}|${(e.reason ?? "").slice(0, 40)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const kind: TrackKind = e.step.startsWith("sequence_send") ? "email" : e.step.startsWith("draft_review") ? "brain" : "data";
    items.push({ at: e.createdAt, kind, tone: tone(e.outcome), title: STEP_LABEL[e.step] ?? e.step.replace(/[._]/g, " "), detail: e.reason, by: `stage ${e.stage}` });
  }

  for (const d of decisions) {
    items.push({ at: d.createdAt, kind: "brain", tone: d.autonomy === "acted" ? "good" : "wait", title: `Brain decided: ${d.choice}`, detail: `For: ${d.caseFor}\nAgainst: ${d.caseAgainst}\nConfidence ${Math.round(d.confidence * 100)}%`, by: d.module.replace(/_/g, " ") });
  }

  for (const d of c.drafts) {
    const versions = d.rewrites + 1;
    items.push({ at: d.createdAt, kind: "email", tone: d.status === "blocked" ? "bad" : "info", title: `Email step ${d.stepOrder} written${versions > 1 ? ` (${versions} versions)` : ""}: "${d.subject}"`, detail: d.status === "blocked" ? `Held: ${d.blockReason}` : d.painPoint ? `Angle: ${d.painPoint}` : null, by: "writer" });
    if (d.reviewedAt) items.push({ at: d.reviewedAt, kind: "email", tone: d.status === "rejected" ? "bad" : "good", title: d.status === "rejected" ? "Email rejected by reviewer" : d.reviewerNote?.startsWith("Auto-approved") ? "Email approved by the brain" : "Email approved by reviewer", detail: d.reviewerNote, by: "review" });
    const m = d.message;
    if (m?.sentAt) items.push({ at: m.sentAt, kind: "email", tone: "good", title: `Email step ${d.stepOrder} sent`, detail: `From ${m.mailbox}`, by: "email channel" });
    if (m?.bouncedAt) items.push({ at: m.bouncedAt, kind: "email", tone: "bad", title: `Email bounced (${m.bounceType ?? "?"})`, by: "email channel" });
  }

  for (const r of c.replies) items.push({ at: r.receivedAt, kind: "email", tone: r.class === "positive" ? "good" : r.class === "unsubscribe" ? "bad" : "info", title: `Email reply: ${r.class.replace(/_/g, " ")}`, detail: r.body.slice(0, 280), by: r.route });

  for (const j of c.journeys) {
    for (const e of j.events) {
      const moved = e.fromStage && e.toStage && e.fromStage !== e.toStage ? ` · ${STAGE_INFO[e.fromStage].label} → ${STAGE_INFO[e.toStage].label}` : "";
      items.push({ at: e.occurredAt, kind: "linkedin", tone: e.type === "reply" || e.toStage === "interested" ? "good" : "info", title: `${LI_LABEL[e.type] ?? e.type}${moved}`, detail: e.detail, by: `${j.sender.name} · ${j.campaign.name}` });
    }
  }

  for (const s of signals) items.push({ at: s.occurredAt, kind: "engagement", tone: s.points >= 20 ? "good" : "info", title: s.type.replace(/_/g, " "), detail: s.detail, by: s.source });
  for (const r of reviews) items.push({ at: r.createdAt, kind: "people", tone: r.status === "open" ? "wait" : "info", title: `Sent to a person: ${r.type.replace(/_/g, " ")}${r.status !== "open" ? ` (${r.status})` : ""}`, detail: r.resolution ? `${r.reason}\n→ ${r.resolution}` : r.reason, by: "review queue", href: "/review" });

  items.sort((a, b) => b.at.getTime() - a.at.getTime());

  // Milestones reached.
  const ok = (step: string) => events.some((e) => e.step === step && e.outcome === "pass");
  const stages = c.journeys.map((j) => j.stage);
  const has = (...s: string[]) => stages.some((x) => s.includes(x));
  const reached: Record<Milestone, boolean> = {
    Added: true,
    Verified: ok("identity.current_role_check") || ok("enrichment.mailbox_verification"),
    Selected: ["selected", "ready", "in_sequence", "replied", "handed_off"].includes(c.state) || c.buyingRole === "decision_maker" || c.buyingRole === "champion",
    Ready: c.readiness === "ready" || ["ready", "in_sequence", "replied", "handed_off"].includes(c.state),
    Drafted: c.drafts.some((d) => d.status !== "blocked"),
    Contacted: c.drafts.some((d) => d.message?.sentAt) || has("connection_sent", "connection_accepted", "follow_up_sent", "replied_neutral", "details_requested", "details_shared", "interested", "call_scheduled", "demo_scheduled", "opportunity", "closed_won", "closed_lost"),
    Engaged: c.replies.length > 0 || has("replied_neutral", "details_requested", "details_shared", "interested", "call_scheduled", "demo_scheduled", "opportunity", "closed_won"),
    Meeting: has("call_scheduled", "demo_scheduled", "opportunity", "closed_won"),
    Opportunity: has("opportunity", "closed_won") || c.state === "handed_off",
  };
  const current = [...MILESTONES].reverse().find((m) => reached[m]) ?? "Added";
  const counts = items.reduce<Record<TrackKind, number>>((t, i) => ({ ...t, [i.kind]: (t[i.kind] ?? 0) + 1 }), { data: 0, brain: 0, email: 0, linkedin: 0, engagement: 0, people: 0 });
  const firstTouch = items.filter((i) => i.kind === "email" || i.kind === "linkedin").at(-1)?.at ?? null;
  return { items, reached, current, counts, firstTouch, daysInSystem: Math.max(0, Math.round((Date.now() - c.createdAt.getTime()) / 86_400_000)) };
}
