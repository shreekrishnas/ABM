// Who may change a client's Account Brain (its seller profile) and its knowledge base.
//
// One rule, checked on the server by every path that writes them, and before the profile
// editor shows a profile: a Super Admin covering that client (Super Admin mode on), or
// someone assigned to that client as Manager or Owner. This is the rule the Account Brain
// editor already applied; the seller-profile and knowledge-base actions now share it.
// Hiding a button is never the check. Every refusal is written to the audit log.

import { authRequired } from "@/lib/auth";
import { audit, coversClient, getMe } from "@/lib/me";
import { ActionDenied, atLeast, denyText } from "@/lib/roles";

type Verdict = { ok: true; actor: string } | { ok: false; actor: string | null; message: string };

async function decide(clientId: unknown): Promise<Verdict> {
  const me = await getMe();
  // Local previews without sign-in only (never in production: sign-in is required there).
  if (!me) return authRequired() ? { ok: false, actor: null, message: "Sign in first" } : { ok: true, actor: "local" };
  if (typeof clientId !== "string" || !clientId) return { ok: false, actor: me.email, message: "You don't have access to that client" };
  if (coversClient(me, clientId)) return { ok: true, actor: me.email };
  const assigned = me.clients.find((c) => c.id === clientId);
  if (!assigned) return { ok: false, actor: me.email, message: "You don't have access to that client" };
  if (!atLeast(assigned.role, "manager")) return { ok: false, actor: me.email, message: denyText(assigned.role, "manager") };
  return { ok: true, actor: me.email };
}

/** Whether the signed-in person may edit this client's Account Brain and knowledge base (no logging; for pages). */
export async function canEditClient(clientId: string): Promise<boolean> {
  return (await decide(clientId)).ok;
}

/**
 * For server actions: returns who is acting, or records `denied.<action>` in the audit log and
 * throws ActionDenied. `clientId` must come from the record being changed or from the signed-in
 * person's scope, never from a fallback.
 */
export async function requireClientEditor(clientId: unknown, action: string, target?: string): Promise<string> {
  const v = await decide(clientId);
  if (v.ok) return v.actor;
  if (v.actor) await audit(v.actor, `denied.${action}`, { clientId: typeof clientId === "string" ? clientId.slice(0, 80) : undefined, target: target?.slice(0, 200) }).catch(() => undefined);
  throw new ActionDenied(v.message);
}

/** Record a change that passed requireClientEditor (local previews without sign-in are not logged). */
export async function auditClientEdit(actor: string, action: string, clientId: string, target?: string): Promise<void> {
  if (actor === "local") return;
  await audit(actor, action, { clientId, target: target?.slice(0, 200) }).catch(() => undefined);
}
