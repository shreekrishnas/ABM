import Link from "next/link";
import { Download, Globe } from "lucide-react";
import { db } from "@/lib/db";
import { nextBestAction, type PriorityParts } from "@/lib/brain/priority";
import { Avatar, TierBadge } from "@/components/ui";
import { IntentPill, SectionLabel, type IntentLevel } from "@/components/v2";

const DAY = 86_400_000;
type Reading = { score: number; level: IntentLevel; whyNow: string | null };

/** Who to work first: the combined priority score, why, and the one next move for each company. */
export async function TopOpportunities({ now }: { now: Date }) {
  const accounts = await db.account.findMany({
    where: { mergedIntoId: null, priorityScore: { not: null }, disqualifyReason: null, stage: { notIn: ["CUSTOMER", "DISQUALIFIED"] } },
    orderBy: { priorityScore: "desc" }, take: 10,
    select: { id: true, name: true, tier: true, stage: true, pipelineStatus: true, disqualifyReason: true, priorityScore: true, priorityParts: true, intentReading: true },
  });
  if (!accounts.length) return null;
  const ids = accounts.map((a) => a.id);
  const since = new Date(now.getTime() - 14 * DAY);
  const [handoffs, drafts, contacts, messages, journeys, visits] = await Promise.all([
    db.handoff.findMany({ where: { accountId: { in: ids }, acknowledgedAt: null }, select: { accountId: true } }),
    db.draft.groupBy({ by: ["contactId"], where: { status: "pending_review", contact: { accountId: { in: ids } } }, _count: true }),
    db.contact.findMany({ where: { accountId: { in: ids }, mergedIntoId: null }, select: { id: true, accountId: true, email: true, fullName: true, state: true } }),
    db.message.findMany({ where: { contact: { accountId: { in: ids } } }, select: { contact: { select: { accountId: true } } } }),
    db.journey.findMany({ where: { contact: { accountId: { in: ids } } }, select: { stage: true, contact: { select: { accountId: true } } } }),
    db.webVisit.findMany({ where: { accountId: { in: ids }, topic: { in: ["pricing", "demo"] }, occurredAt: { gte: since } }, orderBy: { occurredAt: "desc" }, select: { accountId: true, contactId: true } }),
  ]);
  const contactAccount = new Map(contacts.map((c) => [c.id, c.accountId]));
  const rows = accounts.map((a) => {
    const people = contacts.filter((c) => c.accountId === a.id);
    const visit = visits.find((v) => v.accountId === a.id);
    const r = a.intentReading as unknown as Reading | null;
    const action = nextBestAction({
      tier: a.tier, level: r?.level ?? "cold", stage: a.stage, pipelineStatus: a.pipelineStatus, disqualified: Boolean(a.disqualifyReason),
      openHandoff: handoffs.some((h) => h.accountId === a.id),
      pendingDrafts: drafts.filter((d) => contactAccount.get(d.contactId) === a.id).reduce((n, d) => n + d._count, 0),
      people: people.length, reachable: people.filter((c) => c.email && c.state !== "suppressed").length,
      emailed: messages.some((m) => m.contact.accountId === a.id),
      replied: people.some((c) => c.state === "replied") || journeys.some((j) => j.contact.accountId === a.id && ["replied_neutral", "details_requested", "interested"].includes(j.stage)),
      linkedinConnected: journeys.some((j) => j.contact.accountId === a.id && !["not_contacted", "connection_sent"].includes(j.stage)),
      strongVisit: Boolean(visit), visitor: visit?.contactId ? people.find((c) => c.id === visit.contactId)?.fullName ?? null : null,
    });
    const href = action.href === "review" ? "/review" : action.href === "handoffs" ? "/handoffs" : action.href === "people" ? `/accounts/${a.id}?tab=people` : `/accounts/${a.id}`;
    return { a, r, parts: a.priorityParts as unknown as PriorityParts | null, action, href, visited: Boolean(visit) };
  });

  return (
    <section className="mb-6">
      <SectionLabel count={rows.length} action={<span className="flex items-center gap-3"><Link href="/accounts?view=list&sort=priority" className="text-xs font-semibold" style={{ color: "var(--accent-indigo)" }}>All by priority</Link><a href="/accounts/export" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--accent-indigo)" }}><Download size={12} /> Export</a></span>}>Top opportunities — who to work first</SectionLabel>
      <div className="glass-card-static table-wrap">
        <table className="data">
          <thead><tr><th>Company</th><th>Priority</th><th>Intent</th><th className="hide-sm">Why</th><th>Next best action</th></tr></thead>
          <tbody>
            {rows.map(({ a, r, parts, action, href, visited }) => (
              <tr key={a.id}>
                <td className="strong"><Link href={`/accounts/${a.id}`} className="flex items-center gap-2.5"><Avatar name={a.name} id={a.id} size={30} /><span className="min-w-0"><span className="block truncate hover:underline">{a.name}</span><span className="flex items-center gap-1.5"><TierBadge tier={a.tier} />{visited && <span className="chip" title="Pricing or demo page in the last 14 days" style={{ ["--c" as string]: "var(--intent-hot)" }}><Globe size={11} /> On our site</span>}</span></span></Link></td>
                <td>
                  <div className="tnum text-base font-bold" style={{ color: "var(--text-primary)" }}>{a.priorityScore}</div>
                  {parts && <div className="muted whitespace-nowrap text-[0.68rem]" title={`Weights: intent ${parts.weights.intent}%, fit ${parts.weights.fit}%, value ${parts.weights.value}%, timing ${parts.weights.timing}%`}>I {parts.intent} · F {parts.fit} · V {parts.value} · T {parts.timing}</div>}
                </td>
                <td>{r ? <IntentPill level={r.level} score={r.score} /> : <span className="muted text-xs">—</span>}</td>
                <td className="hide-sm max-w-[320px]"><span className="line-clamp-2 text-xs secondary">{r?.whyNow ?? "No converging signals yet"}</span></td>
                <td><Link href={href} className="btn btn-secondary btn-sm whitespace-nowrap">{action.text}</Link><div className="muted mt-1 text-[0.68rem]">{action.why}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-2 text-[0.72rem]">Priority = intent, fit, company value (size) and timing (freshness of the newest signal), weighted in your seller settings. I/F/V/T show each part out of 100.</p>
    </section>
  );
}
