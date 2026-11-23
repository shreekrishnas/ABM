// Client separation: which clients the person behind this request may see. Account.sellerId
// is the client a company belongs to; everything else reaches a client through its account
// (or its own sellerId). Resolved from the session; cached briefly per session.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db-base";
import { GATE_HEADER, REQUEST_ID_HEADER, SESSION_COOKIE, authRequired, authSecret, domainAllowed, verify, type Session } from "@/lib/auth";

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
/**
 * Scopes worked out for requests now in progress, by the request id the gate (src/proxy.ts) gives
 * every request: a scope is reused within one request (every query asks for it) and never across
 * requests, so a removal, an ended session or a changed assignment counts from the next request.
 */
const perRequest = new Map<string, Promise<Scope>>();
const PER_REQUEST_MAX = 1000;

/** Run fn with a fixed scope (tests), or none (null: see every client). */
export function withScope<T>(scope: Scope | null, fn: () => Promise<T>): Promise<T> {
  return override.run({ scope }, fn);
}

/** Background work started from a page (pipeline runs, queue): never limited to the viewer. */
export function unscoped<T>(fn: () => Promise<T>): Promise<T> {
  return override.run({ scope: null }, fn);
}

/**
 * The scope for this request. null = not scoped: outside a request (cron, queue, tests), sign-in
 * switched off (local), or the bearer-key API (/api/v1, which checks its own key and client).
 * Nothing (no client) for: no session on any other request, a forged or expired session, a session
 * ended since it was issued (Sign out everywhere), and a person removed or not on the team.
 */
export async function resolveScope(): Promise<Scope | null> {
  const o = override.getStore();
  if (o) return o.scope;
  const secret = authSecret();
  if (!secret || !authRequired()) return null;
  let jar: Awaited<ReturnType<typeof import("next/headers").cookies>>;
  let gate: string | null = null;
  let requestId: string | null = null;
  try {
    const next = await import("next/headers");
    jar = await next.cookies();
    try {
      const h = await next.headers();
      gate = h.get(GATE_HEADER);
      requestId = h.get(REQUEST_ID_HEADER);
    } catch {
      /* no request headers (some tests): no gate, no per-request reuse */
    }
  } catch {
    return null;
  }
  const token = jar.get(SESSION_COOKIE)?.value;
  // No session: the bearer-key API is unscoped (it limits itself to the key's client); any other request
  // that came through the gate gets nothing (the sign-in pages read nothing private).
  if (!token) return gate && gate !== "api" ? NOTHING : null;
  const superMode = jar.get(MODE_COOKIE)?.value === "super";
  const picked = jar.get(CLIENT_COOKIE)?.value ?? null;
  const work = async () => {
    const session = await verify<Session>(token, secret);
    if (!session || !domainAllowed(session.email)) return NOTHING;
    return scopeFor(session.email, superMode, picked, session.v ?? 0);
  };
  if (!requestId) return work();
  const key = `${requestId}|${token}|${superMode}|${picked ?? ""}`;
  let p = perRequest.get(key);
  if (!p) {
    p = work();
    p.catch(() => perRequest.delete(key));
    if (perRequest.size >= PER_REQUEST_MAX) for (const k of [...perRequest.keys()].slice(0, PER_REQUEST_MAX / 2)) perRequest.delete(k);
    perRequest.set(key, p);
  }
  return p;
}

const NOTHING: Scope = { ids: [], active: null, choices: [], all: false };

/**
 * Pure-ish: the scope for a person, their Super Admin mode and the client they picked. With a session
 * version, a session ended since it was issued sees nothing.
 */
export async function scopeFor(email: string | null, superMode: boolean, picked: string | null, sessionVersion?: number): Promise<Scope> {
  if (!email) return NOTHING;
  const user = await baseDb.user.findUnique({ where: { email }, include: { clients: { include: { client: true } } } });
  if (!user || user.status !== "active") return NOTHING;
  if (sessionVersion !== undefined && sessionVersion !== user.sessionVersion) return NOTHING;
  const sup = user.superAdmin && superMode;
  // A Super Admin covers every client, or only the clients listed on them.
  const all = sup && !user.superAdminClients.length;
  // In Super Admin mode the clients covered can be opened (archived ones too); in User mode (and for everyone else) only assigned ones.
  const choices = sup
    ? (await baseDb.client.findMany({ where: all ? {} : { id: { in: user.superAdminClients } }, orderBy: { name: "asc" }, select: { id: true, name: true, logoUrl: true, status: true } })).map((c) => ({ id: c.id, name: c.status === "archived" ? `${c.name} (archived)` : c.name, logoUrl: c.logoUrl }))
    : user.clients.filter((c) => c.client.status !== "archived").map((c) => ({ id: c.client.id, name: c.client.name, logoUrl: c.client.logoUrl })).sort((a, b) => a.name.localeCompare(b.name));
  const pick = choices.find((c) => c.id === picked)?.id ?? null;
  // With no account picked: Super Admin mode sees everything; otherwise the person's own accounts.
  const ids = pick ? [pick] : all ? null : choices.map((c) => c.id);
  return { ids, active: pick ?? (choices.length === 1 ? choices[0].id : null), choices, all };
}

/** Forget scopes worked out for requests in progress (after an assignment changes mid-request). */
export function clearScopeCache() {
  perRequest.clear();
}

/** The filter that keeps a model's rows inside the given clients; null = not client data. */
/**
 * `platformAdmin`: a full Super Admin (Super Admin mode, every client). Only they see platform-wide
 * records that belong to no client, such as review items with no company and no person (the bounce
 * pause, AI learning proposals). Everyone else neither sees nor changes them: updates and deletes get
 * the same filter, so a client user cannot dismiss a platform-wide item for every client.
 */
export function scopeWhere(model: Prisma.ModelName, ids: string[], opts: { platformAdmin?: boolean } = {}): Record<string, unknown> | null {
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
    case "DiscoverySearch":
    case "VisitorEnrichment":
    case "DailyRecommendation":
    case "AgentAction":
    case "AgentEvent":
    case "AgentSetting":
    case "CareersFeed":
    case "BackgroundJob":
    case "Campaign":
    case "SenderProfile":
      return acct;
    case "WebVisit":
      // The client whose site was visited (set on every visit; older ones by the client_ownership
      // migration). A visit with no client is seen only by a full Super Admin.
      return opts.platformAdmin ? { OR: [acct, { sellerId: null }] } : acct;
    case "Contact":
    case "Opportunity":
    case "Evidence":
    case "TwinVersion":
    case "ResearchQuery":
    case "AccountBrief":
    case "ResearchPlan":
    case "Signal":
    case "WatchlistEntry":
    case "Handoff":
    case "ResearchRun":
    case "Hypothesis":
    case "EvidenceLink":
    case "CompanyFinancial":
    case "FundingRound":
    case "TechUse":
      return { account: acct };
    case "Enrollment":
    case "Draft":
    case "Message":
    case "Reply":
    case "Journey":
      return viaContact;
    case "JourneyEvent":
    case "LinkedInMessage":
      return { journey: viaContact };
    case "Task":
    case "Note":
    case "FieldState":
    case "ReviewItem":
      if (model === "ReviewItem") return { OR: [{ account: acct }, { accountId: null, ...viaContact }, ...(opts.platformAdmin ? [{ accountId: null, contactId: null }] : [])] };
      return { OR: [{ account: acct }, { accountId: null, ...viaContact }, { accountId: null, contactId: null }] };
    case "LedgerEntry":
      // Company costs follow the company; account-level costs (lookalike research) carry the account.
      return { OR: [{ account: acct }, { accountId: null, ...acct }] };
    case "PipelineEvent":
      return { OR: [{ account: acct }, { accountId: null }] };
    default:
      return null; // team, clients, sequences, mailboxes, suppressions, settings: shared
  }
}

/**
 * The client new records belong to, for anything that creates data (imports, API calls). Never
 * guessed: an explicit client, else the client of the run in progress (jobs, the pipeline), else
 * the client picked by the signed-in person. With none of these it refuses.
 */
export async function requireClientId(explicit?: string | null): Promise<string> {
  if (explicit) return explicit;
  const { runSellerId } = await import("@/lib/seller");
  const run = runSellerId();
  if (run) return run;
  const s = await resolveScope();
  if (s?.active) return s.active;
  // Tests only: older test files import without naming a client (and without any scope). Never set outside the test runner.
  if (!s && process.env.VITEST && process.env.TEST_DEFAULT_CLIENT) return process.env.TEST_DEFAULT_CLIENT;
  throw new Error(NO_CLIENT_MESSAGE);
}

/** The client id used when a signed-in person has no client: matches no client, so nothing is shown. */
export const NO_CLIENT_ID = "__no_client__";

/**
 * The client pages show and add to: the picked one, else the first in view. Without a scope (local
 * previews, background work, tests) the default client. A signed-in person with no client in view
 * (none assigned, all removed, or a session that no longer works) gets no client, never the default's.
 */
export async function activeSellerId(): Promise<string> {
  const { DEFAULT_SELLER_ID } = await import("@/lib/seller");
  const s = await resolveScope();
  if (!s) return DEFAULT_SELLER_ID;
  return s.active ?? s.choices[0]?.id ?? NO_CLIENT_ID;
}

/**
 * One client's Account Brain for screens: its saved complete brain (ready), else its own draft,
 * else a blank one under its own name (not ready, with what is missing). Never another client's
 * brain: a client whose brain is unfinished used to be shown the built-in default seller's.
 * Nothing is written; runs still refuse a client without a complete brain.
 */
export async function clientBrain(clientId: string): Promise<{ id: string; pack: import("@/lib/seller").SellerProfile; ready: boolean; missing: string[] }> {
  const { ensureSellerPacks, sellerFor } = await import("@/lib/seller");
  await ensureSellerPacks();
  try {
    return { id: clientId, pack: sellerFor(clientId), ready: true, missing: [] };
  } catch {
    const { loadBrain, readiness } = await import("@/lib/seller/brain");
    const { pack } = await loadBrain(clientId);
    return { id: clientId, pack: { ...pack, id: clientId }, ready: false, missing: readiness(pack).missing };
  }
}

/** The client in view and its Account Brain (see clientBrain). */
export async function activeSellerState() {
  return clientBrain(await activeSellerId());
}

/** The active client's Account Brain pack: its own, complete or not (see clientBrain). */
export async function activeSeller() {
  return (await activeSellerState()).pack;
}
