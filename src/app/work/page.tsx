import { db } from "@/lib/db";
import { SECTIONS, sectionHref } from "@/lib/nav";
import { Hub } from "@/components/hub";

export const metadata = { title: "Workspace" };

/** Workspace: the sections of the work. Each opens its pages, then the records inside them. */
export default async function Workspace() {
  const [replies, approvals, companies, hot, handoffs, tasks] = await Promise.all([
    db.journey.count({ where: { stage: { in: ["details_requested", "interested", "replied_neutral", "referred"] }, contact: { mergedIntoId: null } } }),
    db.draft.count({ where: { status: "pending_review" } }),
    db.account.count({ where: { mergedIntoId: null } }),
    db.account.count({ where: { mergedIntoId: null, intentReading: { path: ["level"], equals: "hot" } } }),
    db.handoff.count({ where: { acknowledgedAt: null, blocked: false } }),
    db.task.count({ where: { status: { in: ["todo", "in_progress"] }, dueAt: { lte: new Date() } } }),
  ]);
  const meta: Record<string, [string, boolean]> = {
    today: [replies + approvals ? `${replies + approvals} need you` : "All clear", replies + approvals > 0],
    research: [`${companies} compan${companies === 1 ? "y" : "ies"}${hot ? ` · ${hot} hot` : ""}`, false],
    outreach: [approvals ? `${approvals} to approve` : "Nothing waiting", approvals > 0],
    sales: [handoffs + tasks ? `${handoffs} hand-off${handoffs === 1 ? "" : "s"} · ${tasks} due` : "Nothing due", handoffs + tasks > 0],
    insights: ["Overview, analytics, settings", false],
  };
  return (
    <Hub
      eyebrow="Workspace"
      title="What do you want to work on?"
      cards={SECTIONS.map((s) => ({ href: sectionHref(s), icon: s.icon, title: s.label, text: s.blurb, meta: meta[s.key]?.[0], alert: meta[s.key]?.[1] }))}
    />
  );
}
