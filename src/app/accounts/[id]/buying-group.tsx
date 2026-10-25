import Link from "next/link";
import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { ActionButton } from "@/components/client";
import { Badge, Card, date } from "@/components/ui";
import { resumeOutreachAction } from "../../actions";

const ROLES = [
  { key: "decision_maker", label: "Decision maker" },
  { key: "champion", label: "Champion" },
  { key: "influencer", label: "Influencer" },
  { key: "budget_owner", label: "Budget owner" },
] as const;
const STATUS_COLOR = { missing: "#DC2626", found: "#64748B", planned: "#B45309", contacted: "#4F46E5", engaged: "#059669" } as const;
type Status = keyof typeof STATUS_COLOR;

/** The company as one buying group: coverage by role, the contact plan, the next person, and any company pause. */
export async function BuyingGroupPlan({ accountId }: { accountId: string }) {
  const now = new Date();
  const [account, contacts, sent, engagedRows] = await Promise.all([
    db.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, outreachPausedUntil: true, outreachPauseReason: true } }),
    db.contact.findMany({ where: { accountId, mergedIntoId: null }, orderBy: [{ planOrder: "asc" }, { createdAt: "asc" }] }),
    db.message.findMany({ where: { contact: { accountId }, status: "delivered" }, select: { contactId: true } }),
    db.signal.findMany({ where: { accountId, contactId: { not: null }, attributed: true }, select: { contactId: true } }),
  ]);
  const emailed = new Set(sent.map((m) => m.contactId));
  const engaged = new Set([...engagedRows.map((s) => s.contactId!), ...contacts.filter((c) => ["replied", "handed_off"].includes(c.state)).map((c) => c.id)]);
  const statusOf = (c: (typeof contacts)[number]): Status => (engaged.has(c.id) ? "engaged" : emailed.has(c.id) ? "contacted" : c.planStartAt ? "planned" : "found");
  const rank: Status[] = ["missing", "found", "planned", "contacted", "engaged"];
  const coverage = ROLES.map((r) => {
    const people = contacts.filter((c) => c.buyingRole === r.key);
    const best = people.reduce<Status>((m, c) => (rank.indexOf(statusOf(c)) > rank.indexOf(m) ? statusOf(c) : m), "missing");
    return { ...r, people, status: people.length ? best : ("missing" as Status) };
  });
  const plan = contacts.filter((c) => c.planOrder != null);
  const eligible = CONFIG.readiness.eligibleRoles as readonly string[];
  const nextPerson = plan.find((c) => !emailed.has(c.id) && !["suppressed", "do_not_contact", "paused", "handed_off"].includes(c.state));
  const missingKey = coverage.find((r) => eligible.includes(r.key) && r.status === "missing");
  const paused = account.outreachPausedUntil && account.outreachPausedUntil > now;

  return (
    <Card title="Buying group plan" sub={`One plan for the company: ${CONFIG.coordination.roleOrder.map((r) => r.replace("_", " ")).join(" first, then ")} · at most ${CONFIG.coordination.maxEmailsPerAccountPerDay} email a day and ${CONFIG.coordination.maxNewPeoplePerWeek} new people a week`} className="mb-5">
      {paused && (
        <div className="bg-banner mb-4">
          <div className="min-w-0"><b>Company outreach paused until {date(account.outreachPausedUntil!)}</b><div className="secondary text-xs">{account.outreachPauseReason}. Colleagues&apos; sequences are paused and unsent drafts were withdrawn.</div></div>
          <ActionButton action={resumeOutreachAction.bind(null, account.id)} className="btn btn-secondary btn-sm">Resume outreach</ActionButton>
        </div>
      )}
      <div className="bg-cover">
        {coverage.map((r) => (
          <div key={r.key} className="bg-role">
            <div className="micro">{r.label}{!eligible.includes(r.key) && <span className="muted"> · not emailed</span>}</div>
            <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>
            <div className="secondary mt-1 truncate text-xs">{r.people.length ? r.people.map((p) => p.fullName).join(", ") : "Nobody found yet"}</div>
          </div>
        ))}
      </div>
      <div className="bg-next">
        <span className="micro">Next best person</span>
        {nextPerson ? (
          <span><Link href={`/people/${nextPerson.id}`} className="font-semibold hover:underline">{nextPerson.fullName}</Link> <span className="secondary text-xs">— {nextPerson.planStartAt && nextPerson.planStartAt > now ? `starts ${date(nextPerson.planStartAt)}` : "due now"} · {nextPerson.planReason}</span></span>
        ) : missingKey ? (
          <span className="secondary text-sm">Find a {missingKey.label.toLowerCase()}: research names the owning function, then Apollo fills the gap on the next run.</span>
        ) : (
          <span className="secondary text-sm">Everyone in the plan has been contacted.</span>
        )}
      </div>
      {plan.length > 0 && (
        <ol className="bg-plan">
          {plan.map((c) => (
            <li key={c.id}>
              <span className="bg-n tnum">{c.planOrder}</span>
              <div className="min-w-0 flex-1"><Link href={`/people/${c.id}`} className="font-semibold hover:underline">{c.fullName}</Link> <span className="muted text-xs">{c.buyingRole.replace("_", " ")}</span><div className="secondary truncate text-xs">{c.planReason}</div></div>
              <span className="muted whitespace-nowrap text-xs">{c.planStartAt ? date(c.planStartAt) : "—"}</span>
              <Badge color={STATUS_COLOR[statusOf(c)]}>{statusOf(c)}</Badge>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
