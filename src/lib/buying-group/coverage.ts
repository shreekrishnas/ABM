// Buying-group coverage: for each company, each role's best status. Shared by the company
// page panel and the cross-company heatmap. "missing" means nobody found, not a negative.

import { db } from "@/lib/db";

export const ROLES = [
  { key: "decision_maker", label: "Decision maker" },
  { key: "champion", label: "Champion" },
  { key: "influencer", label: "Influencer" },
  { key: "budget_owner", label: "Budget owner" },
] as const;
export type RoleKey = (typeof ROLES)[number]["key"];
export const STATUS_ORDER = ["missing", "found", "planned", "contacted", "engaged"] as const;
export type CoverageStatus = (typeof STATUS_ORDER)[number];
export const STATUS_COLOR: Record<CoverageStatus, string> = { missing: "#94A3B8", found: "#64748B", planned: "#B45309", contacted: "#2B2A26", engaged: "#059669" };

export interface ContactCoverage { id: string; fullName: string; buyingRole: string; status: CoverageStatus }

/** Status per person, for the given companies. */
export async function contactStatuses(accountIds: string[]): Promise<Map<string, ContactCoverage[]>> {
  const [contacts, sent, engagedSignals] = await Promise.all([
    db.contact.findMany({ where: { accountId: { in: accountIds }, mergedIntoId: null }, select: { id: true, accountId: true, fullName: true, buyingRole: true, state: true, planStartAt: true } }),
    db.message.findMany({ where: { contact: { accountId: { in: accountIds } }, status: "delivered" }, select: { contactId: true }, distinct: ["contactId"] }),
    db.signal.findMany({ where: { accountId: { in: accountIds }, contactId: { not: null }, attributed: true }, select: { contactId: true }, distinct: ["contactId"] }),
  ]);
  const emailed = new Set(sent.map((m) => m.contactId));
  const engaged = new Set(engagedSignals.map((s) => s.contactId!));
  const out = new Map<string, ContactCoverage[]>();
  for (const c of contacts) {
    const status: CoverageStatus = engaged.has(c.id) || ["replied", "handed_off"].includes(c.state) ? "engaged" : emailed.has(c.id) ? "contacted" : c.planStartAt ? "planned" : "found";
    out.set(c.accountId, [...(out.get(c.accountId) ?? []), { id: c.id, fullName: c.fullName, buyingRole: c.buyingRole, status }]);
  }
  return out;
}

/** Best status per role for one company's people. */
export function roleCoverage(people: ContactCoverage[]) {
  return ROLES.map((r) => {
    const inRole = people.filter((p) => p.buyingRole === r.key);
    const status = inRole.reduce<CoverageStatus>((m, p) => (STATUS_ORDER.indexOf(p.status) > STATUS_ORDER.indexOf(m) ? p.status : m), "missing");
    return { ...r, people: inRole, status };
  });
}
