"use server";

import { revalidatePath } from "next/cache";
import { resetToBuiltIn, restoreRevision, saveSellerPack, sectionLabel, type SaveResult } from "@/lib/seller/edit";

export type PackActionState = { ok: boolean; message: string; problems?: string[] } | null;

function done(r: SaveResult, verb: string): PackActionState {
  if (!r.ok) return { ok: false, message: r.problems.length === 1 ? r.problems[0] : `${r.problems.length} problems — fix them and save again`, problems: r.problems };
  for (const p of ["/", "/settings", "/settings/seller", "/settings/seller/edit", "/discover", "/analytics"]) revalidatePath(p);
  return { ok: true, message: `${verb} (version ${r.version}): ${r.changed.map(sectionLabel).join(", ")}. New runs use it now.` };
}

export async function savePackAction(sellerId: string, packJson: string, note: string): Promise<PackActionState> {
  let pack: unknown;
  try {
    pack = JSON.parse(packJson);
  } catch (e) {
    return { ok: false, message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (packJson.length > 400_000) return { ok: false, message: "The pack is too large (over 400 KB)" };
  return done(await saveSellerPack(sellerId, pack, note), "Saved");
}

export async function restorePackAction(revisionId: string): Promise<PackActionState> {
  return done(await restoreRevision(revisionId), "Restored");
}

export async function resetPackAction(sellerId: string): Promise<PackActionState> {
  return done(await resetToBuiltIn(sellerId), "Reset to the built-in pack");
}
