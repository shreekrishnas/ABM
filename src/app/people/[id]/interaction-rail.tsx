import { Bot, Hand, Link2 as Linkedin, ListTodo, Mail, MessageSquareReply, Radar, StickyNote } from "lucide-react";
import { db } from "@/lib/db";
import { STAGE_INFO, type Stage } from "@/lib/journey/stages";
import { Card, ago } from "@/components/ui";

/** "reply → Details Requested"; a step that names its own stage ("details shared → Details Shared") says it once. */
function railTitle(type: string, from: string | null, to: string | null) {
  const what = type.replaceAll("_", " ");
  const verb = what.charAt(0).toUpperCase() + what.slice(1);
  if (!to || from === to) return verb;
  const stage = STAGE_INFO[to as Stage]?.label ?? to;
  return stage.toLowerCase() === what.toLowerCase() ? stage : `${verb} → ${stage}`;
}

type Item = { at: Date; channel: "email" | "linkedin" | "signal" | "task" | "note"; title: string; detail?: string | null; manual: boolean; by?: string | null };
const ICON = { email: Mail, linkedin: Linkedin, signal: Radar, task: ListTodo, note: StickyNote } as const;
const LABEL = { email: "Email", linkedin: "LinkedIn", signal: "Signal", task: "Task", note: "Note" } as const;

/** Every interaction with one person, newest first, across channels: what happened, where, and whether a person logged it or the system did. */
export async function InteractionRail({ contactId }: { contactId: string }) {
  const [messages, replies, events, signals, tasks, notes] = await Promise.all([
    db.message.findMany({ where: { contactId }, include: { draft: { select: { subject: true, stepOrder: true } } }, orderBy: { sentAt: "desc" }, take: 50 }),
    db.reply.findMany({ where: { contactId }, orderBy: { receivedAt: "desc" }, take: 50 }),
    db.journeyEvent.findMany({ where: { journey: { contactId } }, include: { journey: { select: { sender: { select: { name: true } } } } }, orderBy: { occurredAt: "desc" }, take: 80 }),
    db.signal.findMany({ where: { contactId }, orderBy: { occurredAt: "desc" }, take: 50 }),
    db.task.findMany({ where: { contactId }, include: { assignee: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.note.findMany({ where: { contactId }, include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const items: Item[] = [
    ...messages.map((m): Item => ({ at: m.sentAt ?? new Date(0), channel: "email", title: `${m.status === "delivered" ? "Email sent" : `Email ${m.status.replace("_", " ")}`} · step ${m.draft.stepOrder}`, detail: m.draft.subject, manual: false, by: m.mailbox })),
    ...replies.map((r): Item => ({ at: r.receivedAt, channel: "email", title: `Replied by email · ${r.class.replace("_", " ")}`, detail: r.body.slice(0, 220), manual: false, by: r.route })),
    ...events.filter((e) => e.type !== "imported").map((e): Item => ({
      at: e.occurredAt, channel: "linkedin",
      title: railTitle(e.type, e.fromStage, e.toStage),
      detail: e.detail, manual: e.source !== "agent", by: `${e.journey.sender.name} · logged ${e.source}`,
    })),
    ...signals.filter((s) => s.source !== "linkedin_manual").map((s): Item => ({ at: s.occurredAt, channel: "signal", title: s.type.replaceAll("_", " "), detail: s.detail, manual: s.source === "manual", by: s.source })),
    ...tasks.map((t): Item => ({ at: t.createdAt, channel: "task", title: `${t.status === "done" ? "Done" : "Task"}: ${t.title}`, detail: t.body, manual: t.origin === "manual" || t.origin === "palette", by: t.assignee?.name ?? null })),
    ...notes.map((n): Item => ({ at: n.createdAt, channel: "note", title: "Note", detail: n.body.slice(0, 220), manual: Boolean(n.authorId), by: n.author?.name ?? "system" })),
  ].filter((i) => i.at.getTime() > 0).sort((a, b) => b.at.getTime() - a.at.getTime());

  const counts = { email: items.filter((i) => i.channel === "email").length, linkedin: items.filter((i) => i.channel === "linkedin").length };
  return (
    <Card title="All interactions" sub={`Email and LinkedIn in one timeline · ${counts.email} email · ${counts.linkedin} LinkedIn · LinkedIn steps are logged by the team, never sent by the app`}>
      {items.length === 0 ? <p className="muted text-sm">Nothing yet. Emails, logged LinkedIn steps, signals, tasks and notes appear here. No entry doesn&apos;t mean no reply: LinkedIn only shows what was logged.</p> : (
        <ol className="ir">
          {items.slice(0, 60).map((i, k) => {
            const Icon = ICON[i.channel];
            return (
              <li key={k} className={`ir-item ir-${i.channel}`}>
                <span className="ir-dot"><Icon size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="ir-head"><b>{i.title}</b><span className="ir-tag">{LABEL[i.channel]}</span><span className={`ir-tag ${i.manual ? "man" : "auto"}`}>{i.manual ? <><Hand size={11} /> logged</> : <><Bot size={11} /> automatic</>}</span></div>
                  {i.detail && <div className="secondary line-clamp-2 text-xs">{i.detail}</div>}
                  <div className="muted text-[0.7rem]">{ago(i.at)}{i.by ? ` · ${i.by}` : ""}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
