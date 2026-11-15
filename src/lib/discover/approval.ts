// The approval rule for contact data: Apollo (or any contact provider) may look up
// decision-makers or enrich contact details only for companies a person approved.
// A company counts as approved when it is in the company list (people import or approve
// companies; nothing else creates one) and, if it came from a suggestion, that suggestion
// was approved. Suggestions waiting for review, rejected or ruled out are refused.

import { baseDb } from "@/lib/db-base";
import { normalizeDomain } from "@/lib/pipeline/normalize";
import { runSellerId } from "@/lib/seller";
import type { DataProvider, PersonQuery } from "@/lib/adapters/types";

export class ApprovalRequired extends Error {
  constructor(domain: string) {
    super(`Contact lookup refused for ${domain}: a person has not approved this company yet`);
    this.name = "ApprovalRequired";
  }
}

/**
 * True when a person approved the company with this website, for the client doing the lookup
 * (the run's client): another client's approval of the same company doesn't count. Outside a
 * run, every client's record of that website must be approved.
 */
export async function contactLookupAllowed(domain: string | null | undefined, sellerId: string | null = runSellerId()): Promise<boolean> {
  const d = normalizeDomain(domain);
  if (!d) return false;
  const accounts = await baseDb.account.findMany({ where: { domain: d, mergedIntoId: null, ...(sellerId ? { sellerId } : {}) }, select: { id: true } });
  if (!accounts.length) return false;
  // Created from a suggestion: only once that suggestion was approved.
  const pending = await baseDb.prospectSuggestion.count({ where: { accountId: { in: accounts.map((a) => a.id) }, status: { not: "added" } } });
  return pending === 0;
}

/** Wrap a contact provider so every call checks approval first. */
export function approvalGated(inner: DataProvider): DataProvider {
  const check = async (domain: string | null | undefined) => {
    if (!(await contactLookupAllowed(domain))) throw new ApprovalRequired(domain ?? "a company without a website");
  };
  return {
    name: inner.name,
    async lookupPerson(q: PersonQuery) {
      await check(q.domain);
      return inner.lookupPerson(q);
    },
    async recheckPerson(q: PersonQuery) {
      await check(q.domain);
      return inner.recheckPerson(q);
    },
    async findByFunction(domain: string, fn: string, limit: number) {
      await check(domain);
      return inner.findByFunction(domain, fn, limit);
    },
    async findByTitles(domain: string, titles: string[], limit: number) {
      await check(domain);
      return inner.findByTitles(domain, titles, limit);
    },
    async findEmail(fullName: string, domain: string) {
      await check(domain);
      return inner.findEmail(fullName, domain);
    },
  };
}
