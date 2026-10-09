// Editing seller packs from Settings. Every save is a new SellerPackRevision; nothing
// is overwritten. Restoring an old version or resetting to the built-in pack is also a
// new revision, so the history always shows who-changed-what-when (once auth lands,
// the "who" fills in).

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { builtInPack, ensureSellerPacks, hashPack, loadSeller } from "./index";
import { validatePack } from "./schema";
import { changedSections } from "./diff";

export { changedSections, sectionLabel } from "./diff";
import type { SellerProfile } from "./types";

export type SaveResult = { ok: true; version: string; changed: string[] } | { ok: false; problems: string[] };

/** Parse, validate and save a new version of a seller's pack. */
export async function saveSellerPack(sellerId: string, input: unknown, note?: string | null): Promise<SaveResult> {
  if (!builtInPack(sellerId)) return { ok: false, problems: [`Unknown seller "${sellerId}"`] };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, problems: ["The pack must be a JSON object"] };
  const pack = input as SellerProfile;
  if (pack.id !== sellerId) return { ok: false, problems: [`id must stay "${sellerId}"`] };
  const problems = validatePack(pack);
  if (problems.length) return { ok: false, problems };

  await ensureSellerPacks();
  const current = loadSeller(sellerId).pack;
  const changed = changedSections(current, pack);
  if (!changed.length) return { ok: false, problems: ["Nothing changed"] };
  const version = hashPack(pack);
  await db.sellerPackRevision.create({ data: { sellerId, pack: pack as unknown as Prisma.InputJsonValue, version, changed, note: note?.trim().slice(0, 500) || null } });
  await ensureSellerPacks();
  return { ok: true, version, changed };
}

/** Make an older revision active again (saved as a new revision). */
export async function restoreRevision(revisionId: string): Promise<SaveResult> {
  const r = await db.sellerPackRevision.findUnique({ where: { id: revisionId } });
  if (!r) return { ok: false, problems: ["That version no longer exists"] };
  const label = `Restored version ${r.version} from ${r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  if (r.pack == null) return resetToBuiltIn(r.sellerId, label);
  return saveSellerPack(r.sellerId, r.pack, label);
}

/** Drop all edits: the pack in code becomes active again (history is kept). */
export async function resetToBuiltIn(sellerId: string, note = "Reset to the built-in pack"): Promise<SaveResult> {
  const builtIn = builtInPack(sellerId);
  if (!builtIn) return { ok: false, problems: [`Unknown seller "${sellerId}"`] };
  await ensureSellerPacks();
  const changed = changedSections(loadSeller(sellerId).pack, builtIn);
  if (!changed.length) return { ok: false, problems: ["Already using the built-in pack"] };
  const version = hashPack(builtIn);
  await db.sellerPackRevision.create({ data: { sellerId, pack: undefined, version, changed, note } });
  await ensureSellerPacks();
  return { ok: true, version, changed };
}

export async function listRevisions(sellerId: string, take = 30) {
  return db.sellerPackRevision.findMany({ where: { sellerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, select: { id: true, version: true, changed: true, note: true, createdAt: true, pack: true } });
}

/** How much work was done with a given pack version (facts and drafts carry it). */
export async function versionUsage(sellerId: string, versions: string[]) {
  if (!versions.length) return new Map<string, { facts: number; drafts: number }>();
  const [facts, drafts] = await Promise.all([
    db.evidence.groupBy({ by: ["sellerPackVersion"], where: { sellerId, sellerPackVersion: { in: versions } }, _count: true }),
    db.draft.groupBy({ by: ["sellerPackVersion"], where: { sellerId, sellerPackVersion: { in: versions } }, _count: true }),
  ]);
  const m = new Map<string, { facts: number; drafts: number }>();
  for (const v of versions) m.set(v, { facts: facts.find((f) => f.sellerPackVersion === v)?._count ?? 0, drafts: drafts.find((d) => d.sellerPackVersion === v)?._count ?? 0 });
  return m;
}
