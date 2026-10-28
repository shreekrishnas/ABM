import Link from "next/link";
import { Download, Globe } from "lucide-react";
import { db } from "@/lib/db";
import { nextBestAction, type PriorityParts } from "@/lib/brain/priority";
import { Avatar } from "@/components/ui";
import { Badge, DataTable, EmptyState, type Column } from "@/components/kit";
import type { IntentLevel } from "@/components/v2";

const DAY = 86_400_000;
type Reading = { score: number; level: IntentLevel; whyNow: string | null };

/** Who to work first: the combined priority score, why, and the one next move for each company. */
export async function TopOpportunities({ now, compact }: { now: Date; compact?: boolean }) {
  const accounts = await db.account.findMany({
    where: { mergedIntoId: null, priorityScore: { not: null }, disqualifyReason: null, stage: { notIn: ["CUSTOMER", "DISQUALIFIED"] } },
    orderBy: { priorityScore: "desc" }, take: 10,
    select: { id: true, name: true, tier: true, stage: true, pipelineStatus: true, disqualifyReason: true, priorityScore: true, priorityParts: true, intentReading: true },
  });
  if (!accounts.length) return compact ? <section className="td3-opps"><header><h2>Who to work first</h2></header><EmptyState title="No scored companies yet" text="Companies appear here once research has scored them." /></section> : null;
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

  if (compact) {
    return (
      <section className="td3-opps" aria-labelledby="td3-opps-h">
        <header>
          <h2 id="td3-opps-h">Who to work first</h2>
          <Link href="/accounts?sort=priority" className="td2-link">All by priority</Link>
        </header>
        <ol>
          {rows.slice(0, 6).map(({ a, r, parts, action, href }) => (
            <li key={a.id}>
              <Link href={`/accounts/${a.id}`} className="td3-o-co">
                <Avatar name={a.name} id={a.id} size={28} />
                <span className="min-w-0">
                  <b>{a.name}</b>
                  <span className="td3-o-meta">{a.tier && <Badge>{a.tier}</Badge>}<span className="tnum" title={parts ? `I ${parts.intent} · F ${parts.fit} · V ${parts.value} · T ${parts.timing}` : undefined}>Priority {a.priorityScore}</span>{r && <Badge tone={r.level === "hot" ? "danger" : r.level === "warm" ? "warning" : "info"}>{r.level[0].toUpperCase() + r.level.slice(1)}</Badge>}</span>
                </span>
              </Link>
              <p className="td3-o-why">{r?.whyNow ?? "No converging signals yet"}</p>
              <Link href={href} className="btn btn-secondary btn-sm td3-o-act">{action.text}</Link>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  type R = (typeof rows)[number];
  const columns: Column<R>[] = [
    { key: "co", header: "Company", primary: true, cell: ({ a, visited }) => (
      <Link href={`/accounts/${a.id}`} className="td2-co"><Avatar name={a.name} id={a.id} size={28} /><span className="min-w-0"><b>{a.name}</b><span className="td2-co-m">{a.tier && <Badge>{a.tier}</Badge>}{visited && <Badge tone="danger" icon={<Globe size={11} aria-hidden />}>On our site</Badge>}</span></span></Link>
    ) },
    { key: "p", header: "Priority", align: "right", cell: ({ a, parts }) => (
      <span title={parts ? `Weights: intent ${parts.weights.intent}%, fit ${parts.weights.fit}%, value ${parts.weights.value}%, timing ${parts.weights.timing}%` : undefined}><b className="tnum">{a.priorityScore}</b>{parts && <span className="td2-s tnum">I {parts.intent} · F {parts.fit} · V {parts.value} · T {parts.timing}</span>}</span>
    ) },
    { key: "i", header: "Intent", cell: ({ r }) => (r ? <Badge tone={r.level === "hot" ? "danger" : r.level === "warm" ? "warning" : "info"}>{r.level[0].toUpperCase() + r.level.slice(1)} · {Math.round(r.score)}</Badge> : <span className="td2-s">—</span>) },
    { key: "w", header: "Why", priority: 2, cell: ({ r }) => <span className="td2-why">{r?.whyNow ?? "No converging signals yet"}</span> },
    { key: "n", header: "Next best action", cell: ({ action, href }) => <span className="td2-next"><Link href={href} className="btn btn-secondary btn-sm">{action.text}</Link><span className="td2-s">{action.why}</span></span> },
  ];

  return (
    <section className="td2-sec td2-top">
      <header>
        <h2>Who to work first</h2>
        <Badge tone="accent">{rows.length}</Badge>
        <Link href="/accounts?sort=priority" className="td2-link">All by priority</Link>
        <a href="/accounts/export" className="td2-link"><Download size={12} /> Export</a>
      </header>
      <DataTable columns={columns} rows={rows} rowKey={(x) => x.a.id} caption="Top opportunities" />
      <p className="td2-note">Priority = intent, fit, company value (size) and timing (freshness of the newest signal), weighted in your Account Brain. I/F/V/T show each part out of 100.</p>
    </section>
  );
}
