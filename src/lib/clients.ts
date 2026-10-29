// The Accounts page: one card per client account a person may open.
// Only accounts in the person's own scope are read; every figure is counted per account,
// so one card never includes another account's data.

import { baseDb } from "@/lib/db-base";
import { sellerFor } from "@/lib/seller";
import type { Scope } from "@/lib/scope";

export interface AccountCard {
  id: string;
  name: string;
  description: string | null;
  companies: number;
  people: number;
  toApprove: number;
  decisions: number;
  lastActivity: Date | null;
}

/** Cards for the accounts in this scope (null scope = local, sign-in off: every account). */
export async function accountCards(scope: Scope | null): Promise<AccountCard[]> {
  const choices = scope ? scope.choices : await baseDb.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return Promise.all(
    choices.map(async (c) => {
      const acct = { sellerId: c.id };
      const [companies, people, toApprove, decisions, last] = await Promise.all([
        baseDb.account.count({ where: { ...acct, mergedIntoId: null } }),
        baseDb.contact.count({ where: { account: acct, mergedIntoId: null } }),
        baseDb.draft.count({ where: { status: "pending_review", contact: { account: acct } } }),
        baseDb.reviewItem.count({ where: { status: "open", type: { not: "draft_approval" }, account: acct } }),
        baseDb.account.findFirst({ where: acct, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      ]);
      let description: string | null = null;
      try {
        const p = sellerFor(c.id);
        description = (p.summary || p.positioning || "").split(/(?<=\.)\s/)[0] || null;
      } catch {
        description = null;
      }
      return { id: c.id, name: c.name, description, companies, people, toApprove, decisions, lastActivity: last?.updatedAt ?? null };
    }),
  );
}
