// One-off clean-ups for data saved under older rules.

import { baseDb } from "@/lib/db-base";

/**
 * People used to be marked "conflicting" when their email wasn't on the company's domain
 * (gmail.com, another domain). Any address is fine now: mark those emails probable and close
 * the "Is this the right person?" items that were only about the email. Items where the title
 * or employer also disagree stay open for a person to decide.
 */
export async function clearEmailOnlyConflicts(): Promise<{ emails: number; reviews: number }> {
  const emails = await baseDb.fieldState.updateMany({ where: { field: "email", status: "conflicting" }, data: { status: "probable" } });
  const open = await baseDb.reviewItem.findMany({ where: { type: "identity_conflict", status: "open" }, select: { id: true, contactId: true } });
  let reviews = 0;
  for (const r of open) {
    if (!r.contactId) continue;
    const other = await baseDb.fieldState.count({ where: { contactId: r.contactId, field: { in: ["title", "company"] }, status: "conflicting" } });
    if (other) continue;
    await baseDb.reviewItem.update({ where: { id: r.id }, data: { status: "resolved", resolvedAt: new Date(), resolution: "Closed: only the email domain differed, and any address is fine now" } });
    reviews++;
  }
  return { emails: emails.count, reviews };
}
