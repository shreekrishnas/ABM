"use server";

import { revalidatePath } from "next/cache";
import { baseDb } from "@/lib/db-base";
import { auditClientEdit, requireClientEditor } from "@/lib/client-access";
import { resetToBuiltIn, restoreRevision, saveSellerPack, sectionLabel, type SaveResult } from "@/lib/seller/edit";

export type PackActionState = { ok: boolean; message: string; problems?: string[] } | null;

function done(r: SaveResult, verb: string): PackActionState {
  if (!r.ok) return { ok: false, message: r.problems.length === 1 ? r.problems[0] : `${r.problems.length} problems — fix them and save again`, problems: r.problems };
  for (const p of ["/", "/settings", "/settings/seller", "/settings/seller/edit", "/discover", "/analytics"]) revalidatePath(p);
  return { ok: true, message: `${verb} (version ${r.version}): ${r.changed.map(sectionLabel).join(", ")}. New runs use it now.` };
}

/** Only someone who may edit that client's Account Brain gets past here (lib/client-access). */
async function editorOf(sellerId: unknown, action: string, target?: string): Promise<{ actor: string } | { denied: PackActionState }> {
  try {
    return { actor: await requireClientEditor(sellerId, action, target) };
  } catch (e) {
    return { denied: { ok: false, message: e instanceof Error ? e.message : "Not allowed" } };
  }
}

export async function savePackAction(sellerId: string, packJson: string, note: string): Promise<PackActionState> {
  const g = await editorOf(sellerId, "account_brain.profile_save");
  if ("denied" in g) return g.denied;
  if (typeof packJson !== "string") return { ok: false, message: "Not valid JSON" };
  let pack: unknown;
  try {
    pack = JSON.parse(packJson);
  } catch (e) {
    return { ok: false, message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (packJson.length > 400_000) return { ok: false, message: "The pack is too large (over 400 KB)" };
  const r = await saveSellerPack(sellerId, pack, typeof note === "string" ? note : "");
  if (r.ok) await auditClientEdit(g.actor, "account_brain.profile_save", sellerId, `version ${r.version}: ${r.changed.join(", ")}`);
  return done(r, "Saved");
}

export async function restorePackAction(revisionId: string): Promise<PackActionState> {
  // The client is the one the version belongs to (looked up unscoped, so the check below decides, not a missing row).
  const rev = typeof revisionId === "string" ? await baseDb.sellerPackRevision.findUnique({ where: { id: revisionId }, select: { sellerId: true } }) : null;
  if (!rev) return { ok: false, message: "That version no longer exists" };
  const g = await editorOf(rev.sellerId, "account_brain.profile_restore", revisionId);
  if ("denied" in g) return g.denied;
  const r = await restoreRevision(revisionId);
  if (r.ok) await auditClientEdit(g.actor, "account_brain.profile_restore", rev.sellerId, `version ${r.version}`);
  return done(r, "Restored");
}

export async function resetPackAction(sellerId: string): Promise<PackActionState> {
  const g = await editorOf(sellerId, "account_brain.profile_reset");
  if ("denied" in g) return g.denied;
  const r = await resetToBuiltIn(sellerId);
  if (r.ok) await auditClientEdit(g.actor, "account_brain.profile_reset", sellerId);
  return done(r, "Reset to the built-in pack");
}
