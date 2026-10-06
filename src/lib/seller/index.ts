// Active seller. Today: Manch Technologies. Add profiles to SELLERS to onboard others.

import { MANCH } from "./manch";
import type { SellerProfile } from "./types";

export const SELLERS: Record<string, SellerProfile> = { manch: MANCH };

export const ACTIVE_SELLER_ID = process.env.ACTIVE_SELLER ?? "manch";

export function seller(): SellerProfile {
  return SELLERS[ACTIVE_SELLER_ID] ?? MANCH;
}

export type { SellerProfile } from "./types";
