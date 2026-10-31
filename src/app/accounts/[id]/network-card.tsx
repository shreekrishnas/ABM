import { db } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { Card } from "@/components/ui";
import { ROLES, contactStatuses, roleCoverage } from "@/lib/buying-group/coverage";
import { BuyingNetwork, type NetPerson } from "@/components/viz/buying-network";

/** Gathers people, their status and how much we've interacted with each, for the network view. */
export async function NetworkCard({ accountId, company }: { accountId: string; company: string }) {
  const [contacts, statuses, msgs, replies, signals, events] = await Promise.all([
    db.contact.findMany({ where: { accountId, mergedIntoId: null }, select: { id: true, fullName: true, titleNormalized: true, title: true, function: true, buyingRole: true, stakeholderType: true } }),
    contactStatuses([accountId]),
    db.message.groupBy({ by: ["contactId"], where: { contact: { accountId } }, _count: true }),
    db.reply.groupBy({ by: ["contactId"], where: { contact: { accountId } }, _count: true }),
    db.signal.groupBy({ by: ["contactId"], where: { accountId, contactId: { not: null } }, _count: true }),
    db.journeyEvent.findMany({ where: { journey: { contact: { accountId } } }, select: { journey: { select: { contactId: true } } } }),
  ]);
  const n = (rows: { contactId: string | null; _count: number }[], id: string) => rows.find((r) => r.contactId === id)?._count ?? 0;
  const status = new Map((statuses.get(accountId) ?? []).map((s) => [s.id, s.status]));
  const people: NetPerson[] = contacts.map((c) => ({
    id: c.id, name: c.fullName, title: c.titleNormalized ?? c.title, // Directors, investors and advisers sit outside the org chart: their own row, not "Executive".
    fn: c.stakeholderType !== "executive" ? "Board and advisers" : c.function ? (c.function.length <= 3 ? c.function.toUpperCase() : c.function[0].toUpperCase() + c.function.slice(1)) : "Function unknown", role: c.buyingRole,
    status: status.get(c.id) ?? "found",
    interactions: n(msgs, c.id) + n(replies, c.id) + n(signals, c.id) + events.filter((e) => e.journey.contactId === c.id).length,
  }));
  const eligible = CONFIG.readiness.eligibleRoles as readonly string[];
  const missing = roleCoverage(statuses.get(accountId) ?? []).filter((r) => eligible.includes(r.key) && r.status === "missing").map((r) => ROLES.find((x) => x.key === r.key)!.label);
  return (
    <Card title="Buying-group network" sub="Who we know, by function. Ring = where they are in outreach; bar = how much we have interacted." className="mb-5">
      <BuyingNetwork company={company} people={people} missing={missing} />
    </Card>
  );
}
