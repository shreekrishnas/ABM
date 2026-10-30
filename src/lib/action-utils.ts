// Helpers shared by the server action modules (not actions themselves).

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { kickDrain } from "@/lib/queue/drain";

/** Revalidate Home, Today and the given pages. */
export const refresh = (...paths: string[]) => {
  for (const p of ["/", "/work/today", ...paths]) revalidatePath(p);
};

/** This deployment's own origin, so the background queue can call its route. */
export async function requestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Start the background queue once this response is sent. */
export async function startBackgroundQueue() {
  const origin = await requestOrigin();
  after(() => kickDrain(origin));
}

/** A trimmed, non-empty form value. */
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** Who is deciding (for the record). */
export async function decider() {
  const { getMe } = await import("@/lib/me");
  return (await getMe())?.email ?? null;
}
