// Live research per client: which clients may use real web search. Off means their companies
// stay queued untouched and no search runs for them. Stored as IntegrationSetting rows
// "research:<clientId>"; without a row, only the clients in RESEARCH_ON_BY_DEFAULT are on.
// The Test client never searches for real: it always runs on stand-in services.

import { baseDb } from "@/lib/db-base";

export const RESEARCH_ON_BY_DEFAULT = ["manch"];
const KEY = (id: string) => `research:${id}`;

export class ResearchOff extends Error {
  constructor(client: string) {
    super(`Live research is off for this client (${client})`);
    this.name = "ResearchOff";
  }
}

let cached: { at: number; on: Set<string> } | null = null;

/** Client ids with live research on. Cached for 15 s per server instance. */
export async function researchOnIds(): Promise<string[]> {
  if (cached && Date.now() - cached.at < 15_000) return [...cached.on];
  const rows = await baseDb.integrationSetting.findMany({ where: { key: { startsWith: "research:" } }, select: { key: true, enabled: true } }).catch(() => []);
  const set = new Set(RESEARCH_ON_BY_DEFAULT);
  for (const r of rows) {
    const id = r.key.slice("research:".length);
    if (r.enabled) set.add(id);
    else set.delete(id);
  }
  set.delete("test");
  cached = { at: Date.now(), on: set };
  return [...set];
}

export async function researchAllowed(clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return false;
  return (await researchOnIds()).includes(clientId);
}

export async function setResearchAllowed(clientId: string, on: boolean, by: string) {
  await baseDb.integrationSetting.upsert({ where: { key: KEY(clientId) }, create: { key: KEY(clientId), enabled: on, updatedBy: by }, update: { enabled: on, updatedBy: by } });
  cached = null;
}

/**
 * Called by the live search adapter before any real search: the run's client, or the client the
 * person is working in, must have live research on. Throws ResearchOff otherwise.
 */
export async function assertResearchAllowed() {
  const { runSellerId } = await import("@/lib/seller");
  let id = runSellerId();
  if (!id) id = await (await import("@/lib/scope")).activeSellerId().catch(() => null);
  if (!(await researchAllowed(id))) throw new ResearchOff(id ?? "unknown");
}
