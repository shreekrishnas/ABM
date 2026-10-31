// Helpers shared by the server action modules (not actions themselves).

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { kickDrain } from "@/lib/queue/drain";

/** Revalidate Home, Today and the given pages. */
export const refresh = (...paths: string[]) => {
  for (const p of ["/", "/work/today", ...paths]) revalidatePath(p);
};

/** This deployment's own origin, so the background queue can call its route. */
export async function requestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Start the background queue once this response is sent. */
export async function startBackgroundQueue() {
  const origin = await requestOrigin();
  after(() => kickDrain(origin));
}

/** A trimmed, non-empty form value. */
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** Who is deciding (for the record). */
export async function decider() {
  const { getMe } = await import("@/lib/me");
  return (await getMe())?.email ?? null;
}

/** What an action was about; any one of these identifies the company and account. */
export interface ActionRef {
  accountId?: string | null;
  contactId?: string | null;
  reviewId?: string | null;
  draftId?: string | null;
  handoffId?: string | null;
  opportunityId?: string | null;
  evidenceId?: string | null;
  suggestionId?: string | null;
  detail?: string | null;
}

/**
 * Record who did what (shown in Team & Access → Audit log). Never throws: an action
 * must not fail because its log entry couldn't be written.
 */
export async function logAction(action: string, ref: ActionRef = {}): Promise<void> {
  try {
    const [{ getMe, audit }, { baseDb }] = await Promise.all([import("@/lib/me"), import("@/lib/db-base")]);
    const me = await getMe();
    if (!me) return;
    let accountId = ref.accountId ?? null;
    let person: string | null = null;
    let name: string | null = null;
    let clientId: string | null = null;
    if (!accountId && ref.contactId) accountId = (await baseDb.contact.findUnique({ where: { id: ref.contactId }, select: { accountId: true } }))?.accountId ?? null;
    if (ref.contactId) person = (await baseDb.contact.findUnique({ where: { id: ref.contactId }, select: { fullName: true } }))?.fullName ?? null;
    if (!accountId && ref.reviewId) {
      const r = await baseDb.reviewItem.findUnique({ where: { id: ref.reviewId }, select: { accountId: true, contact: { select: { fullName: true, accountId: true } } } });
      accountId = r?.accountId ?? r?.contact?.accountId ?? null;
      person = person ?? r?.contact?.fullName ?? null;
    }
    if (!accountId && ref.draftId) {
      const d = await baseDb.draft.findUnique({ where: { id: ref.draftId }, select: { contact: { select: { fullName: true, accountId: true } } } });
      accountId = d?.contact.accountId ?? null;
      person = person ?? d?.contact.fullName ?? null;
    }
    if (!accountId && ref.handoffId) accountId = (await baseDb.handoff.findUnique({ where: { id: ref.handoffId }, select: { accountId: true } }))?.accountId ?? null;
    if (!accountId && ref.opportunityId) accountId = (await baseDb.opportunity.findUnique({ where: { id: ref.opportunityId }, select: { accountId: true } }))?.accountId ?? null;
    if (!accountId && ref.evidenceId) accountId = (await baseDb.evidence.findUnique({ where: { id: ref.evidenceId }, select: { accountId: true } }))?.accountId ?? null;
    if (accountId) {
      const a = await baseDb.account.findUnique({ where: { id: accountId }, select: { name: true, sellerId: true } });
      name = a?.name ?? null;
      clientId = a?.sellerId ?? null;
    } else if (ref.suggestionId) {
      const s = await baseDb.prospectSuggestion.findUnique({ where: { id: ref.suggestionId }, select: { name: true, sellerId: true } });
      name = s?.name ?? null;
      clientId = s?.sellerId ?? null;
    }
    const target = [person, name, ref.detail].filter(Boolean).join(" · ") || undefined;
    await audit(me.email, action, { target, ...(clientId ? { clientId } : {}) });
  } catch {
    // never block the action
  }
}
