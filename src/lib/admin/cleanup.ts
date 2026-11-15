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

/**
 * Re-check people waiting on "Is this the right person?" under today's rules, using only what is
 * already saved (no lookups, no AI): titles that say the same thing ("AVP IT" / "Associate Vice
 * President - IT"), and an address on the company's own domain as proof of employer. People whose
 * identity now checks out leave the queue and their company is picked up again from the people
 * step; everyone else stays, with the reason. Nothing is deleted.
 */
export async function recheckWaitingPeople(sellerId?: string): Promise<{ checked: number; confirmed: string[]; stillWaiting: { name: string; why: string }[]; companies: number }> {
  const { titlesAgree, emailOnCompanyDomain } = await import("@/lib/pipeline/gates");
  const items = await baseDb.reviewItem.findMany({
    where: { status: "open", type: { in: ["identity_conflict", "lawful_basis_missing"] }, contactId: { not: null }, ...(sellerId ? { account: { sellerId } } : {}) },
    include: { contact: { include: { account: { select: { id: true, domain: true, pipelineStatus: true } } } } },
  });
  const ok = (s?: string) => s === "verified" || s === "probable";
  const confirmed: string[] = [];
  const stillWaiting: { name: string; why: string }[] = [];
  const requeue = new Set<string>();
  const now = new Date();
  for (const it of items) {
    const c = it.contact;
    if (!c?.account) continue;
    const rows = await baseDb.fieldState.findMany({ where: { contactId: c.id } });
    const f = Object.fromEntries(rows.map((r) => [r.field, r]));
    const set = (field: string, status: "verified" | "probable", source: string) =>
      baseDb.fieldState.upsert({ where: { contactId_field: { contactId: c.id, field } }, create: { contactId: c.id, field, status, source, value: field === "company" ? c.account!.domain : null }, update: { status, source, checkedAt: now } });
    const myTitle = c.titleNormalized ?? c.title;
    const providerTitle = (it.payload as { providerTitle?: string | null } | null)?.providerTitle ?? null;
    // Same title, written differently.
    if (f.title?.status === "conflicting" && titlesAgree(myTitle, providerTitle)) {
      await set("title", "verified", f.title.source ?? "provider");
      f.title = { ...f.title, status: "verified" };
    }
    // Employer from the email domain; then the title from your own list.
    if (!ok(f.company?.status) && f.company?.status !== "conflicting" && emailOnCompanyDomain(c.email, c.account.domain)) {
      await set("company", "probable", "email domain");
      f.company = { ...(f.company ?? rows[0]), status: "probable" } as (typeof rows)[number];
      if (!ok(f.title?.status) && f.title?.status !== "conflicting" && myTitle) {
        await set("title", "probable", "your list");
        f.title = { ...(f.title ?? rows[0]), status: "probable" } as (typeof rows)[number];
      }
    }
    const missing = [
      !c.email ? "no email address yet" : !ok(f.email?.status) && f.email?.status !== undefined ? `email ${f.email.status}` : "",
      f.title?.status === "conflicting" ? `title differs: "${myTitle}" vs "${providerTitle ?? "another source"}"` : !ok(f.title?.status) ? "title not confirmed" : "",
      f.company?.status === "conflicting" ? "another source shows a different employer" : !ok(f.company?.status) ? "employer not confirmed" : "",
    ].filter(Boolean);
    if (missing.length) {
      stillWaiting.push({ name: c.fullName, why: missing.join("; ") });
      continue;
    }
    await baseDb.reviewItem.update({ where: { id: it.id }, data: { status: "resolved", resolvedAt: now, resolution: "Re-checked: identity confirmed (same title written differently, or email on the company's domain)" } });
    await baseDb.contact.update({ where: { id: c.id }, data: { readiness: null, readinessReasons: [] } });
    confirmed.push(c.fullName);
    if (c.account.pipelineStatus !== "running" && c.account.pipelineStatus !== "queued") requeue.add(c.account.id);
  }
  // Their companies continue from the people step (roles, email check, readiness, drafting).
  if (requeue.size) await baseDb.account.updateMany({ where: { id: { in: [...requeue] }, pipelineStatus: { notIn: ["running", "queued"] } }, data: { pipelineStatus: "queued", queuedFromStage: 8, nextRetryAt: null } });
  return { checked: items.length, confirmed, stillWaiting, companies: requeue.size };
}
