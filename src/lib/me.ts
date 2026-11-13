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
  clients: { id: string; name: string; role: import("@/lib/roles").Role }[];
  /** May switch into Super Admin. */
  canSuperAdmin: boolean;
  /** Super Admin is switched on for this session. */
  superAdmin: boolean;
  /** The clients this Super Admin covers; null = every client. Empty for people who aren't Super Admin. */
  superAdminClients: string[] | null;
  /** Super Admin is on and covers every client: workspace-wide settings, the system, security. */
  fullSuperAdmin: boolean;
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
  if ((session.v ?? 0) !== user.sessionVersion) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    // Archived clients leave team members' menus (a Super Admin still reaches them).
    clients: user.clients.filter((c) => user.superAdmin || c.client.status !== "archived").map((c) => ({ id: c.client.id, name: c.client.name, role: (["owner", "manager", "rep", "viewer"].includes(c.role) ? c.role : "manager") as import("@/lib/roles").Role })),
    canSuperAdmin: user.superAdmin,
    superAdmin: user.superAdmin && jar.get(MODE_COOKIE)?.value === "super",
    superAdminClients: superAdminClientsOf(user),
    fullSuperAdmin: user.superAdmin && jar.get(MODE_COOKIE)?.value === "super" && !user.superAdminClients.length,
  };
});

/** The clients a user covers as Super Admin: null = every client, [] = not a Super Admin. */
export function superAdminClientsOf(user: { superAdmin: boolean; superAdminClients: string[] }): string[] | null {
  if (!user.superAdmin) return [];
  return user.superAdminClients.length ? [...user.superAdminClients] : null;
}

/** Super Admin is on and this client is one of theirs. */
export function coversClient(me: Pick<Me, "superAdmin" | "superAdminClients"> | null, clientId: string): boolean {
  if (!me?.superAdmin) return false;
  return me.superAdminClients === null || me.superAdminClients.includes(clientId);
}

/** For Super Admin actions: the actor, or an error to return. */
export async function requireSuperAdmin(): Promise<Me> {
  await (await import("@/lib/integration-keys")).syncIntegrationEnv().catch(() => undefined);
  const me = await getMe();
  if (!me?.superAdmin) throw new Error("Super Admin only: switch to Super Admin first");
  return me;
}

/** For workspace-wide actions (the system, security, integrations, new clients): a Super Admin over every client. */
export async function requireFullSuperAdmin(): Promise<Me> {
  const me = await requireSuperAdmin();
  if (!me.fullSuperAdmin) throw new Error("Only a Super Admin over all clients can do this");
  return me;
}

/** For one client's settings: a Super Admin who covers that client. */
export async function requireClientAdmin(clientId: string): Promise<Me> {
  const me = await requireSuperAdmin();
  if (!coversClient(me, clientId)) throw new Error("You're not Super Admin for this client");
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
