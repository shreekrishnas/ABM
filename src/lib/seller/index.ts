// Seller packs. Every account belongs to exactly one seller (account.sellerId); a run
// loads that seller's pack once, validates it, and every module reads seller-specific
// content only through seller() for the rest of the run, so a run never mixes sellers.
// Adding a seller = adding a pack here. No core code changes.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { MANCH } from "./manch";
import { validatePack } from "./schema";
import type { SellerProfile } from "./types";

export const SELLERS: Record<string, SellerProfile> = { manch: MANCH };

export const DEFAULT_SELLER_ID = process.env.ACTIVE_SELLER ?? "manch";
/** @deprecated use DEFAULT_SELLER_ID */
export const ACTIVE_SELLER_ID = DEFAULT_SELLER_ID;

export interface SellerContext {
  pack: SellerProfile;
  version: string;
}

const versions = new Map<string, string>();

/** Short hash of the pack's content: stored with every output so results stay comparable and a change can be rolled back. */
export function packVersion(p: SellerProfile): string {
  let v = versions.get(p.id);
  if (!v) {
    v = createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 12);
    versions.set(p.id, v);
  }
  return v;
}

/** The Seller context module: load and validate a pack. Throws if the pack is unknown or invalid. */
export function loadSeller(id: string | null | undefined): SellerContext {
  const pack = SELLERS[id ?? DEFAULT_SELLER_ID];
  if (!pack) throw new Error(`Unknown seller "${id}" — add its pack to src/lib/seller`);
  const problems = validatePack(pack);
  if (problems.length) throw new Error(`Seller pack "${pack.id}" is invalid: ${problems.slice(0, 3).join("; ")}`);
  return { pack, version: packVersion(pack) };
}

const als = new AsyncLocalStorage<SellerContext>();

/** Run fn with one seller's pack as the active identity. */
export function withSeller<T>(id: string | null | undefined, fn: () => Promise<T>): Promise<T> {
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

export type { SellerProfile, ResearchQuestion } from "./types";
