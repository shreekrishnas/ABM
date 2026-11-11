// Paused and archived clients: their research and sending stop; archived ones also leave
// team members' client menus. Nothing is deleted.
import { baseDb } from "@/lib/db-base";

export type ClientStatus = "active" | "paused" | "archived";
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { active: "Active", paused: "Paused", archived: "Archived" };
export const isClientStatus = (v: unknown): v is ClientStatus => v === "active" || v === "paused" || v === "archived";

let cached: { at: number; ids: string[] } | null = null;

/** Ids of clients whose work is stopped (paused or archived). Cached for 15 s per server instance. */
export async function stoppedClientIds(): Promise<string[]> {
  if (cached && Date.now() - cached.at < 15_000) return cached.ids;
  const rows = await baseDb.client.findMany({ where: { status: { not: "active" } }, select: { id: true } }).catch(() => []);
  cached = { at: Date.now(), ids: rows.map((r) => r.id) };
  return cached.ids;
}

export function forgetClientStatus() {
  cached = null;
}
