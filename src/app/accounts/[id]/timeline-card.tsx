import { db } from "@/lib/db";
import { collectSignals } from "@/lib/brain/intent";
import { Card } from "@/components/ui";
import { SignalTimeline, type TimelineItem } from "@/components/viz/signal-timeline";

const LANES = [
  { key: "trigger", label: "Buying triggers" },
  { key: "programme", label: "Programmes" },
  { key: "leadership", label: "New leaders" },
  { key: "hiring", label: "Hiring" },
  { key: "third_party", label: "Intent data" },
  { key: "conversation", label: "LinkedIn" },
  { key: "engagement", label: "Visits & clicks" },
  { key: "outreach", label: "Our emails" },
  { key: "reply", label: "Replies" },
  { key: "negative", label: "Red flags" },
];

/** The company's signal history on one time axis (server side gathers; the client draws). */
export async function TimelineCard({ accountId }: { accountId: string }) {
  const [signals, messages, replies] = await Promise.all([
    collectSignals(accountId),
    db.message.findMany({ where: { contact: { accountId }, status: { in: ["delivered", "bounced"] } }, select: { sentAt: true, status: true, contactId: true, draft: { select: { subject: true, stepOrder: true } }, contact: { select: { fullName: true } } }, take: 200 }),
    db.reply.findMany({ where: { contact: { accountId } }, select: { receivedAt: true, class: true, body: true, contactId: true, contact: { select: { fullName: true } } }, take: 200 }),
  ]);
  const ev = await db.evidence.findMany({ where: { id: { in: signals.flatMap((s) => s.refs) } }, select: { id: true, sourceUrl: true } });
  const url = new Map(ev.map((e) => [e.id, e.sourceUrl]));
  const items: TimelineItem[] = [
    ...signals.filter((s) => s.at && s.family !== "team_context").map((s) => ({
      lane: s.family, label: s.label, at: s.at!.toISOString(), strength: s.strength, negative: s.family === "negative",
      href: s.refs.map((r) => url.get(r)).find(Boolean) ?? (s.contactId ? `/people/${s.contactId}` : null),
    })),
    ...messages.filter((m) => m.sentAt).map((m) => ({ lane: "outreach", label: `${m.status === "bounced" ? "Bounced" : "Email"} to ${m.contact.fullName} · step ${m.draft.stepOrder}: ${m.draft.subject}`, at: m.sentAt!.toISOString(), strength: 0.5, href: `/people/${m.contactId}` })),
    ...replies.map((r) => ({ lane: "reply", label: `${r.contact.fullName} replied (${r.class.replace("_", " ")}): ${r.body.slice(0, 90)}`, at: r.receivedAt.toISOString(), strength: r.class === "positive" ? 1 : 0.6, href: `/people/${r.contactId}` })),
  ];
  return (
    <Card title="Signal timeline" sub="Every signal at this company on one axis. Bigger dot = stronger signal (fresher, better sourced). Shaded spans: two or more different kinds of signal within 30 days.">
      <SignalTimeline items={items} lanes={LANES} />
    </Card>
  );
}
