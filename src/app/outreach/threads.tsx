import Link from "next/link";
import { Mail, MessageSquareText } from "lucide-react";
import { db } from "@/lib/db";
import { Avatar, Empty, ago, date } from "@/components/ui";

const DRAFT_STATE: Record<string, { label: string; color: string }> = {
  pending_review: { label: "Waiting for approval", color: "var(--wait)" },
  approved: { label: "Approved — waiting to send", color: "var(--accent-indigo)" },
  sent: { label: "Sent", color: "var(--ok)" },
  blocked: { label: "Held by checks", color: "var(--stop)" },
  rejected: { label: "Rejected", color: "var(--intent-cold)" },
};

type Bubble = { at: Date; dir: "out" | "in"; channel: "email" | "linkedin"; title?: string; body: string; state?: { label: string; color: string } };

/** Emails as conversations: everyone we are writing to on the left, the whole thread on the right. */
export async function EmailThreads({ selected }: { selected?: string }) {
  const people = await db.contact.findMany({
    where: { mergedIntoId: null, drafts: { some: {} } },
    include: { account: { select: { name: true } }, drafts: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, status: true, subject: true } }, _count: { select: { replies: true } } },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  if (people.length === 0) return <div className="glass-card-static card-pad"><Empty icon={<Mail size={20} />} title="No conversations yet" sub="Emails appear here as soon as the brain drafts one." /></div>;
  const current = people.find((p) => p.id === selected) ?? people[0];
  const c = await db.contact.findUniqueOrThrow({
    where: { id: current.id },
    include: { account: { select: { id: true, name: true } }, drafts: { orderBy: { createdAt: "asc" }, include: { message: true } }, replies: { orderBy: { receivedAt: "asc" } }, journeys: { include: { sender: { select: { name: true } }, events: { where: { type: { in: ["reply", "follow_up_sent", "connection_accepted"] } }, orderBy: { occurredAt: "asc" } } } } },
  });
  const bubbles: Bubble[] = [
    ...c.drafts.map((d) => ({ at: d.message?.sentAt ?? d.createdAt, dir: "out" as const, channel: "email" as const, title: d.subject, body: d.body.split("\n\n").slice(0, 6).join("\n\n"), state: DRAFT_STATE[d.status] })),
    ...c.replies.map((r) => ({ at: r.receivedAt, dir: "in" as const, channel: "email" as const, body: r.body })),
    ...c.journeys.flatMap((j) => j.events.map((e) => ({ at: e.occurredAt, dir: e.type === "reply" ? ("in" as const) : ("out" as const), channel: "linkedin" as const, body: e.type === "reply" ? (e.detail?.split(" · ")[0] ?? "Replied") : e.type === "connection_accepted" ? `Accepted the connection (${j.sender.name})` : `Follow-up sent by ${j.sender.name}` }))),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" style={{ minHeight: 560 }}>
      <nav className="glass-card-static overflow-hidden" aria-label="Conversations" style={{ padding: "0.5rem" }}>
        <div className="micro px-2 py-2">Conversations · {people.length}</div>
        <ul className="grid gap-0.5" style={{ maxHeight: 640, overflowY: "auto" }}>
          {people.map((p) => {
            const on = p.id === current.id;
            const st = p.drafts[0] ? DRAFT_STATE[p.drafts[0].status] : null;
            return (
              <li key={p.id}>
                <Link href={`/outreach?view=threads&c=${p.id}`} aria-current={on ? "true" : undefined} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors" style={{ background: on ? "var(--surface-card-elevated)" : undefined, boxShadow: on ? "0 4px 12px rgba(99,102,241,0.15)" : undefined }}>
                  <Avatar name={p.fullName} id={p.id} size={32} round />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold" style={{ color: on ? "var(--accent-indigo)" : "var(--text-primary)" }}>{p.fullName}</span><span className="muted shrink-0 text-[0.68rem]">{ago(p.drafts[0]?.createdAt)}</span></span>
                    <span className="muted block truncate text-xs">{p.account.name}</span>
                    {st && <span className="mt-0.5 inline-flex items-center gap-1 text-[0.68rem] font-semibold" style={{ color: st.color }}><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />{st.label}{p._count.replies ? ` · ${p._count.replies} repl${p._count.replies > 1 ? "ies" : "y"}` : ""}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="glass-card-static read flex flex-col" style={{ padding: 0 }} aria-label={`Conversation with ${c.fullName}`}>
        <header className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-3">
            <Avatar name={c.fullName} id={c.id} size={38} round />
            <div>
              <Link href={`/people/${c.id}`} className="text-[0.95rem] font-bold hover:underline" style={{ color: "var(--text-primary)" }}>{c.fullName}</Link>
              <div className="muted text-xs">{c.titleNormalized ?? c.title ?? ""} · <Link href={`/accounts/${c.account.id}`} className="hover:underline">{c.account.name}</Link> · <span className="mono">{c.email ?? "no email"}</span></div>
            </div>
          </div>
          <Link href={`/people/${c.id}`} className="btn btn-secondary btn-sm">Full journey</Link>
        </header>
        <ol className="flex flex-1 flex-col gap-4 px-5 py-5">
          {bubbles.map((b, i) => (
            <li key={i} className={`flex ${b.dir === "out" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[78%]">
                <div className={`mb-1 flex items-center gap-1.5 text-[0.68rem] ${b.dir === "out" ? "justify-end" : ""}`} style={{ color: "var(--text-muted)" }}>
                  {b.channel === "linkedin" ? <MessageSquareText size={11} /> : <Mail size={11} />}{b.channel === "linkedin" ? "LinkedIn" : "Email"} · {date(b.at)}
                  {b.state && <span className="font-semibold" style={{ color: b.state.color }}>· {b.state.label}</span>}
                </div>
                <div className="whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm" style={b.dir === "out"
                  ? { background: b.channel === "email" ? "linear-gradient(135deg, rgba(124,58,237,0.10), rgba(79,70,229,0.08))" : "var(--surface-card-header)", border: "1px solid rgba(124,58,237,0.18)", color: "var(--text-primary)", borderTopRightRadius: 6 }
                  : { background: "var(--surface-card-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", borderTopLeftRadius: 6, boxShadow: "var(--shadow-rest)" }}>
                  {b.title && <div className="mb-1.5 font-semibold">{b.title}</div>}
                  <span className="secondary">{b.body}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
