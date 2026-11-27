// "At a glance": the four answers a person wants before reading anything else about a company.
// Is it worth pursuing, why now, who to contact, and what to do next. Worked out from what is
// already stored (the research brief, the intent reading, the buying group, drafts); nothing is
// researched or written here. The company page and the weekly report both use it, so they agree.

import type { Account, BuyingRole, Contact } from "@prisma/client";
import { db } from "@/lib/db";
import type { AccountBriefData } from "@/lib/brain/types";

export type GlanceTone = "good" | "maybe" | "weak" | "stop" | "none";

export interface Glance {
  verdict: { label: string; why: string | null; tone: GlanceTone };
  whyNow: string | null;
  contact: { id: string; name: string; title: string | null; role: string } | null;
  next: string;
}

type GlanceAccount = Pick<Account, "id" | "stage" | "doNotContact" | "disqualifyReason" | "fitScore" | "intentReading">;

const ROLE_ORDER: BuyingRole[] = ["decision_maker", "budget_owner", "champion", "influencer", "unknown"];
export const ROLE_WORD: Record<BuyingRole, string> = { decision_maker: "Decision maker", budget_owner: "Budget owner", champion: "Champion", influencer: "Influencer", unknown: "Contact" };
const SENIORITY = ["c_level", "vp", "director", "manager", "ic"];
const REACHABLE = new Set(["ready", "in_sequence", "replied"]);

/** The person to contact first: buying role, then whether they can be reached, then seniority. Board members and advisers are never picked. */
export function pickContact<C extends Pick<Contact, "buyingRole" | "state" | "seniority" | "stakeholderType" | "fullName">>(people: C[]): C | null {
  const pool = people.filter((p) => p.stakeholderType === "executive" && p.state !== "suppressed" && p.state !== "do_not_contact");
  const rank = (p: C) => [ROLE_ORDER.indexOf(p.buyingRole), REACHABLE.has(p.state) ? 0 : 1, p.seniority ? SENIORITY.indexOf(p.seniority) : SENIORITY.length];
  return [...pool].sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.fullName.localeCompare(b.fullName);
  })[0] ?? null;
}

function verdictOf(a: GlanceAccount, brief: AccountBriefData | null): Glance["verdict"] {
  if (a.stage === "DISQUALIFIED") return { label: "Ruled out", why: a.disqualifyReason, tone: "stop" };
  if (brief) {
    const words = { strong: ["Strong fit", "good"], moderate: ["Possible fit", "maybe"], weak: ["Weak fit", "weak"] } as const;
    const [label, tone] = words[brief.verdict];
    return { label, why: brief.verdictWhy, tone };
  }
  if (a.fitScore == null) return { label: "Not scored yet", why: "Scored once research has run", tone: "none" };
  if (a.fitScore >= 70) return { label: "Strong fit", why: `Fit score ${a.fitScore}/100`, tone: "good" };
  if (a.fitScore >= 45) return { label: "Possible fit", why: `Fit score ${a.fitScore}/100`, tone: "maybe" };
  return { label: "Weak fit", why: `Fit score ${a.fitScore}/100`, tone: "weak" };
}

function nextOf(a: GlanceAccount, brief: AccountBriefData | null, pendingDrafts: number, hasContact: boolean): string {
  if (a.stage === "DISQUALIFIED") return "Nothing to do: this company is ruled out";
  if (a.doNotContact) return "Do not contact this company";
  if (a.stage === "MQA" || a.stage === "OPPORTUNITY") return "With sales: follow up with the account owner";
  if (pendingDrafts > 0) return `Review ${pendingDrafts} draft${pendingDrafts === 1 ? "" : "s"} waiting in Approvals`;
  if (brief?.nextBestAction) return brief.nextBestAction;
  if (!hasContact) return "Find the people to contact (Buying group)";
  return "Finish research: run the pipeline for this company";
}

/** At-a-glance answers for many companies at once (three queries, whatever the number). */
export async function glanceFor(accounts: GlanceAccount[]): Promise<Map<string, Glance>> {
  const ids = accounts.map((a) => a.id);
  if (!ids.length) return new Map();
  const [briefRows, people, drafts] = await Promise.all([
    db.accountBrief.findMany({ where: { accountId: { in: ids } }, orderBy: { version: "desc" }, select: { accountId: true, brief: true } }),
    db.contact.findMany({ where: { accountId: { in: ids }, mergedIntoId: null }, select: { id: true, accountId: true, fullName: true, title: true, buyingRole: true, state: true, seniority: true, stakeholderType: true } }),
    db.draft.groupBy({ by: ["contactId"], where: { status: "pending_review", contact: { accountId: { in: ids }, mergedIntoId: null } }, _count: true }),
  ]);
  const briefOf = new Map<string, AccountBriefData>();
  for (const r of briefRows) if (!briefOf.has(r.accountId)) briefOf.set(r.accountId, r.brief as unknown as AccountBriefData);
  const accountOfContact = new Map(people.map((p) => [p.id, p.accountId]));
  const pending = new Map<string, number>();
  for (const d of drafts) {
    const acc = accountOfContact.get(d.contactId);
    if (acc) pending.set(acc, (pending.get(acc) ?? 0) + d._count);
  }
  const out = new Map<string, Glance>();
  for (const a of accounts) {
    const brief = briefOf.get(a.id) ?? null;
    const reading = a.intentReading as { whyNow?: string | null } | null;
    const top = pickContact(people.filter((p) => p.accountId === a.id));
    out.set(a.id, {
      verdict: verdictOf(a, brief),
      whyNow: brief?.whyNow?.text ?? reading?.whyNow ?? null,
      contact: top ? { id: top.id, name: top.fullName, title: top.title, role: ROLE_WORD[top.buyingRole] } : null,
      next: nextOf(a, brief, pending.get(a.id) ?? 0, Boolean(top)),
    });
  }
  return out;
}

export async function glanceForOne(a: GlanceAccount): Promise<Glance> {
  return (await glanceFor([a])).get(a.id)!;
}
