// Client separation: which clients the person behind this request may see. Account.sellerId
// is the client a company belongs to; everything else reaches a client through its account
// (or its own sellerId). Resolved from the session; cached briefly per session.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { SESSION_COOKIE, authRequired, authSecret, verify, type Session } from "@/lib/auth";

export const CLIENT_COOKIE = "abm_client";
const MODE_COOKIE = "abm_mode";
export const NO_CLIENT_MESSAGE = "Pick a client at the top of the menu first";

export type Scope = {
  /** Client ids this request may see; null = every client (Super Admin, all clients). */
  ids: string[] | null;
  /** The one client new companies and imports go to; null when several are in view. */
  active: string | null;
  /** Clients this person can switch between. */
  choices: { id: string; name: string; logoUrl?: string | null }[];
  /** Super Admin is switched on. */
  all: boolean;
};

const override = new AsyncLocalStorage<{ scope: Scope | null }>();
const cache = new Map<string, { scope: Scope; at: number }>();
const TTL_MS = 10_000;

/** Run fn with a fixed scope (tests), or none (null: see every client). */
export function withScope<T>(scope: Scope | null, fn: () => Promise<T>): Promise<T> {
  return override.run({ scope }, fn);
}

/** Background work started from a page (pipeline runs, queue): never limited to the viewer. */
export function unscoped<T>(fn: () => Promise<T>): Promise<T> {
  return override.run({ scope: null }, fn);
}

/**
 * The scope for this request. null = not scoped: outside a request (cron, queue, tests),
 * sign-in switched off (local), or no session (only /api/v1 with its own key gets here).
 * A session whose person is removed or not on the team sees nothing.
 */
export async function resolveScope(): Promise<Scope | null> {
  const o = override.getStore();
  if (o) return o.scope;
  const secret = authSecret();
  if (!secret || !authRequired()) return null;
  let jar: Awaited<ReturnType<typeof import("next/headers").cookies>>;
  try {
    const { cookies } = await import("next/headers");
    jar = await cookies();
  } catch {
    return null;
  }
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const key = `${token}|${jar.get(MODE_COOKIE)?.value ?? ""}|${jar.get(CLIENT_COOKIE)?.value ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.scope;
  const session = await verify<Session>(token, secret);
  const scope = await scopeFor(session?.email ?? null, jar.get(MODE_COOKIE)?.value === "super", jar.get(CLIENT_COOKIE)?.value ?? null);
  if (cache.size > 500) cache.clear();
  cache.set(key, { scope, at: Date.now() });
  return scope;
}

const NOTHING: Scope = { ids: [], active: null, choices: [], all: false };

/** Pure-ish: the scope for a person, their Super Admin mode and the client they picked. */
export async function scopeFor(email: string | null, superMode: boolean, picked: string | null): Promise<Scope> {
  if (!email) return NOTHING;
  const user = await baseDb.user.findUnique({ where: { email }, include: { clients: { include: { client: true } } } });
  if (!user || user.status !== "active") return NOTHING;
  const all = user.superAdmin && superMode;
  // A Super Admin can open every account (in either mode); everyone else only their own.
  const choices = user.superAdmin
    ? await baseDb.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, logoUrl: true } })
    : user.clients.map((c) => ({ id: c.client.id, name: c.client.name, logoUrl: c.client.logoUrl })).sort((a, b) => a.name.localeCompare(b.name));
  const pick = choices.find((c) => c.id === picked)?.id ?? null;
  // With no account picked: Super Admin mode sees everything; otherwise the person's own accounts.
  const own = user.clients.map((c) => c.client.id);
  const ids = pick ? [pick] : all ? null : user.superAdmin && own.length ? own : choices.map((c) => c.id);
  return { ids, active: pick ?? (choices.length === 1 ? choices[0].id : null), choices, all };
}

/** Forget cached scopes (after an assignment changes). */
export function clearScopeCache() {
  cache.clear();
}

/** The filter that keeps a model's rows inside the given clients; null = not client data. */
export function scopeWhere(model: Prisma.ModelName, ids: string[]): Record<string, unknown> | null {
  const acct = { sellerId: { in: ids } };
  const viaContact = { contact: { account: acct } };
  switch (model) {
    case "Account":
    case "BrainSignal":
    case "Decision":
    case "Proposal":
    case "MarketEvent":
    case "ProspectSuggestion":
    case "SellerPackRevision":
    case "KnowledgeDoc":
    case "KnowledgeChunk":
    case "ImportBatch":
      return acct;
    case "Contact":
    case "Opportunity":
    case "Evidence":
    case "TwinVersion":
    case "ResearchQuery":
    case "AccountBrief":
    case "ResearchPlan":
    case "Signal":
    case "WatchlistEntry":
    case "LedgerEntry":
    case "Handoff":
    case "ResearchRun":
    case "Hypothesis":
    case "EvidenceLink":
      return { account: acct };
    case "Enrollment":
    case "Draft":
    case "Message":
    case "Reply":
    case "Journey":
      return viaContact;
    case "JourneyEvent":
      return { journey: viaContact };
    case "Task":
    case "Note":
    case "FieldState":
    case "ReviewItem":
      return { OR: [{ account: acct }, { accountId: null, ...viaContact }, { accountId: null, contactId: null }] };
    case "PipelineEvent":
      return { OR: [{ account: acct }, { accountId: null }] };
    default:
      return null; // team, clients, sequences, mailboxes, suppressions, settings: shared
  }
}

/** The client pages show and add to: the picked one, else the first in view, else the default. */
export async function activeSellerId(): Promise<string> {
  const { DEFAULT_SELLER_ID } = await import("@/lib/seller");
  const s = await resolveScope();
  return s?.active ?? s?.choices[0]?.id ?? DEFAULT_SELLER_ID;
}

/** The active client's Account Brain pack (the built-in default while a new brain is incomplete). */
export async function activeSeller() {
  const { ensureSellerPacks, seller, sellerFor } = await import("@/lib/seller");
  await ensureSellerPacks();
  const id = await activeSellerId();
  try {
    return sellerFor(id);
  } catch {
    return seller();
  }
}
