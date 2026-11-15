// Which client an API request is for. A client's own key (abm_<clientId>_<secret>) binds the
// request to that client. The workspace key (ABM_API_KEY) is an admin key: it must name the
// client (x-client-id header or clientId in the body). Either way the client must exist and not
// be archived, and a request never reaches another client's records.

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { baseDb } from "@/lib/db-base";
import { authorize, safeEqual } from "@/lib/api";

const PREFIX = "abm_";
const settingKey = (clientId: string) => `apikey:${clientId}`;
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/** The client a key belongs to, from its own text (abm_<clientId>_<secret>). */
function clientOfKey(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length);
  const cut = rest.lastIndexOf("_");
  return cut > 0 ? rest.slice(0, cut) : null;
}

/** Make a new API key for one client (replacing any earlier one). Returned once; only its hash is kept. */
export async function createClientKey(clientId: string, by: string): Promise<string> {
  // Hex: the secret never contains "_", so the client part of the key reads back unambiguously.
  const key = `${PREFIX}${clientId}_${randomBytes(24).toString("hex")}`;
  await baseDb.integrationSetting.upsert({
    where: { key: settingKey(clientId) },
    create: { key: settingKey(clientId), enabled: true, secrets: hash(key), updatedBy: by },
    update: { enabled: true, secrets: hash(key), updatedBy: by },
  });
  return key;
}

/** Turn a client's API key off. The row is kept (disabled), so the audit trail stays readable. */
export async function revokeClientKey(clientId: string, by: string): Promise<boolean> {
  const r = await baseDb.integrationSetting.updateMany({ where: { key: settingKey(clientId) }, data: { enabled: false, updatedBy: by } });
  return r.count > 0;
}

/** Whether a client has an active API key, and when it was last changed. */
export async function clientKeyState(clientId: string): Promise<{ active: boolean; updatedAt: Date | null }> {
  const row = await baseDb.integrationSetting.findUnique({ where: { key: settingKey(clientId) }, select: { enabled: true, updatedAt: true } });
  return { active: Boolean(row?.enabled), updatedAt: row?.updatedAt ?? null };
}

/** Draft ids from Message-IDs like <draftId@abm.local> in reply headers, in the order given. */
export function threadDraftIds(...headers: (string | undefined)[]): string[] {
  const ids: string[] = [];
  for (const h of headers) for (const m of (h ?? "").matchAll(/<([^<>@\s]+)@abm\.local>/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

const fail = (status: number, error: string, message: string) => NextResponse.json({ error, message }, { status });

/**
 * The client this request may act for, or the response to send instead.
 * `named` is the clientId the request body names, if any.
 */
export async function authorizeClient(req: Request, named?: string | null): Promise<{ clientId: string } | { response: NextResponse }> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const fromHeader = req.headers.get("x-client-id")?.trim() || null;
  if (named && fromHeader && named !== fromHeader) return { response: fail(400, "client_mismatch", "The x-client-id header and clientId in the body name different clients") };
  const asked = named ?? fromHeader;

  let clientId: string;
  const keyClient = token ? clientOfKey(token) : null;
  if (keyClient) {
    // A client's own key: bound to that client.
    const row = await baseDb.integrationSetting.findUnique({ where: { key: settingKey(keyClient) }, select: { enabled: true, secrets: true } });
    if (!row?.enabled || !row.secrets || !safeEqual(row.secrets, hash(token))) return { response: fail(401, "unauthorized", "Unknown or revoked API key") };
    if (asked && asked !== keyClient) return { response: fail(403, "wrong_client", "This API key belongs to another client") };
    clientId = keyClient;
  } else {
    // The workspace key (or an open local API): it must say which client.
    const denied = authorize(req);
    if (denied) return { response: denied };
    if (!asked) return { response: fail(400, "client_required", "Name the client: send x-client-id (or clientId in the body), or use that client's own API key") };
    clientId = asked;
  }
  const client = await baseDb.client.findUnique({ where: { id: clientId }, select: { status: true } });
  if (!client) return { response: fail(404, "client_not_found", `No client "${clientId}"`) };
  if (client.status === "archived") return { response: fail(403, "client_archived", "This client is archived") };
  return { clientId };
}
