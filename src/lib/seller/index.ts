// Seller packs. Every account belongs to exactly one seller (account.sellerId); a run
// loads that seller's pack once, validates it, and every module reads seller-specific
// content only through seller() for the rest of the run, so a run never mixes sellers.
// Adding a seller = adding a pack here. No core code changes.
//
// Packs can be edited in Settings. Edits are saved as SellerPackRevision rows; the
// newest valid revision overrides the built-in pack. ensureSellerPacks() loads them into
// memory (it runs at the start of every pipeline run and page render), so seller()
// stays synchronous everywhere else.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { MANCH } from "./manch";
import { validatePack } from "./schema";
import { canonicalJson } from "./diff";
import type { SellerProfile } from "./types";

/** Built-in packs, in code. The editor's "Reset to built-in" goes back to these. */
export const SELLERS: Record<string, SellerProfile> = { manch: MANCH };

export const DEFAULT_SELLER_ID = process.env.ACTIVE_SELLER ?? "manch";
/** @deprecated use DEFAULT_SELLER_ID */
export const ACTIVE_SELLER_ID = DEFAULT_SELLER_ID;

export interface SellerContext {
  pack: SellerProfile;
  version: string;
}

const versions = new WeakMap<SellerProfile, string>();

/** Short hash of the pack's content: stored with every output so results stay comparable and a change can be rolled back. */
export function packVersion(p: SellerProfile): string {
  let v = versions.get(p);
  if (!v) {
    v = hashPack(p);
    versions.set(p, v);
  }
  return v;
}

export function hashPack(p: SellerProfile): string {
  return createHash("sha256").update(canonicalJson(p)).digest("hex").slice(0, 12);
}

// ── Edited packs (database) ──

interface Override {
  revisionId: string;
  pack: SellerProfile;
  savedAt: Date;
}
const overrides = new Map<string, Override>();
/** Revisions that failed validation when loaded (e.g. saved before a schema change): kept out of runs. */
const rejected = new Map<string, { revisionId: string; problems: string[] }>();

/**
 * Load the newest revision per seller into memory. Cheap (one indexed query), so it
 * runs at the start of every pipeline run and page render. If the database is
 * unreachable, the last loaded state (or the built-in pack) stays in use.
 */
export async function ensureSellerPacks(): Promise<void> {
  let latest: { id: string; sellerId: string; pack: unknown; createdAt: Date }[];
  try {
    latest = await db.sellerPackRevision.findMany({
      where: { sellerId: { in: Object.keys(SELLERS) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["sellerId"],
      select: { id: true, sellerId: true, pack: true, createdAt: true },
    });
  } catch {
    return;
  }
  overrides.clear();
  rejected.clear();
  for (const r of latest) {
    if (r.pack == null) continue; // reset to the built-in pack
    const pack = r.pack as SellerProfile;
    const problems = pack.id === r.sellerId ? validatePack(pack) : [`pack id "${pack.id}" does not match seller "${r.sellerId}"`];
    if (problems.length) {
      rejected.set(r.sellerId, { revisionId: r.id, problems });
      continue;
    }
    overrides.set(r.sellerId, { revisionId: r.id, pack, savedAt: r.createdAt });
  }
}

/** Where a seller's active pack comes from, for the Settings screens. */
export function packSource(id: string | null | undefined) {
  const sid = id ?? DEFAULT_SELLER_ID;
  const o = overrides.get(sid);
  return {
    source: o ? ("edited" as const) : ("built-in" as const),
    revisionId: o?.revisionId ?? null,
    savedAt: o?.savedAt ?? null,
    rejected: rejected.get(sid) ?? null,
  };
}

/** The pack in code, ignoring edits. */
export function builtInPack(id: string | null | undefined): SellerProfile | undefined {
  return SELLERS[id ?? DEFAULT_SELLER_ID];
}

/** The Seller context module: load and validate a pack. Throws if the pack is unknown or invalid. */
export function loadSeller(id: string | null | undefined): SellerContext {
  const sid = id ?? DEFAULT_SELLER_ID;
  const pack = overrides.get(sid)?.pack ?? SELLERS[sid];
  if (!pack) throw new Error(`Unknown seller "${id}" — add its pack to src/lib/seller`);
  const problems = validatePack(pack);
  if (problems.length) throw new Error(`Seller pack "${pack.id}" is invalid: ${problems.slice(0, 3).join("; ")}`);
  return { pack, version: packVersion(pack) };
}

const als = new AsyncLocalStorage<SellerContext>();

/** Run fn with one seller's pack (the latest saved edit, if any) as the active identity. */
export async function withSeller<T>(id: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  await ensureSellerPacks();
  return als.run(loadSeller(id), fn);
}

export function sellerContext(): SellerContext {
  return als.getStore() ?? loadSeller(DEFAULT_SELLER_ID);
}

/** The active seller's pack (the run's seller, or the default outside a run). */
export function seller(): SellerProfile {
  return sellerContext().pack;
}

/** A specific seller's pack, for screens about one account. */
export function sellerFor(id: string | null | undefined): SellerProfile {
  return loadSeller(id).pack;
}

/** Test hook: forget loaded edits. */
export function clearSellerOverrides() {
  overrides.clear();
  rejected.clear();
}

export type { SellerProfile, ResearchQuestion } from "./types";
