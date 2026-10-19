// Who is signed in, which clients they may see, and whether Super Admin is switched on.
// Super Admin is an entitlement on the user; the mode cookie only says whether it is in use
// right now, and is re-checked against the user record on every request.

import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, authRequired, authSecret, verify, type Session } from "@/lib/auth";

export const MODE_COOKIE = "abm_mode";

export type Me = {
  id: string;
  name: string;
  email: string;
  clients: { id: string; name: string }[];
  /** May switch into Super Admin. */
  canSuperAdmin: boolean;
  /** Super Admin is switched on for this session. */
  superAdmin: boolean;
};

/** The signed-in user, or null when sign-in is off (local/dev) or nobody is signed in. */
export const getMe = cache(async (): Promise<Me | null> => {
  const secret = authSecret();
  if (!secret) return null;
  const jar = await cookies();
  const session = await verify<Session>(jar.get(SESSION_COOKIE)?.value, secret);
  if (!session) return null;
  const user = await db.user.findUnique({ where: { email: session.email }, include: { clients: { include: { client: true } } } });
  if (!user || user.status !== "active") return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    clients: user.clients.map((c) => ({ id: c.client.id, name: c.client.name })),
    canSuperAdmin: user.superAdmin,
    superAdmin: user.superAdmin && jar.get(MODE_COOKIE)?.value === "super",
  };
});

/** For Super Admin actions: the actor, or an error to return. */
export async function requireSuperAdmin(): Promise<Me> {
  const me = await getMe();
  if (!me?.superAdmin) throw new Error("Super Admin only: switch to Super Admin first");
  return me;
}

/** Sign-in is on but this request has no active team member behind it. */
export async function signedOutOrRemoved(): Promise<boolean> {
  return authRequired() && Boolean(authSecret()) && !(await getMe());
}

export async function audit(actorEmail: string, action: string, data: { target?: string; clientId?: string; before?: unknown; after?: unknown } = {}) {
  await db.auditEntry.create({
    data: {
      actorEmail,
      action,
      target: data.target ?? null,
      clientId: data.clientId ?? null,
      before: data.before === undefined ? undefined : (data.before as object),
      after: data.after === undefined ? undefined : (data.after as object),
    },
  });
}
