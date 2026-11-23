"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureSellerPacks } from "@/lib/seller";
import { activeSellerId, clientBrain } from "@/lib/scope";
import { baseDb } from "@/lib/db-base";
import { auditClientEdit, requireClientEditor } from "@/lib/client-access";
import { addDocument, deleteDocument, DOC_KINDS, ensureIndexed, forgetSync, syncBuiltIns } from "@/lib/knowledge/rag/store";
import { clearRetrievalCache, retrieve } from "@/lib/knowledge/rag/retrieve";

export type KbState = { ok: boolean; message: string } | null;

const list = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

const docInput = z.object({
  title: z.string().trim().min(3, "Give the document a title").max(200),
  text: z.string().trim().min(40, "Paste at least a paragraph of text").max(300_000, "Too long — split it into smaller documents (300 KB max)"),
  kind: z.enum(DOC_KINDS),
  url: z.string().trim().url("Source link must be a full URL").max(500).optional().or(z.literal("")),
});

// Every change is for the client in view (the signed-in person's scope), never a fallback, and only
// by someone who may edit that client's Account Brain (lib/client-access); refusals are audit-logged.

const denied = (e: unknown): KbState => ({ ok: false, message: e instanceof Error ? e.message.slice(0, 200) : String(e) });

export async function addDocumentAction(_: KbState, fd: FormData): Promise<KbState> {
  const p = docInput.safeParse({ title: fd.get("title"), text: fd.get("text"), kind: fd.get("kind"), url: fd.get("url") ?? "" });
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const channel = fd.get("channel");
  const clientId = await activeSellerId();
  let actor: string;
  try {
    actor = await requireClientEditor(clientId, "knowledge.add", p.data.title);
  } catch (e) {
    return denied(e);
  }
  try {
    await ensureSellerPacks();
    const r = await addDocument({
      sellerId: clientId, title: p.data.title, text: p.data.text, kind: p.data.kind, url: p.data.url || null, approved: fd.get("approved") === "on",
      tags: { channel: channel === "email" || channel === "linkedin" ? channel : undefined, personas: list(fd.get("personas")), plays: list(fd.get("plays")) },
    });
    await auditClientEdit(actor, "knowledge.add", clientId, p.data.title);
    revalidatePath("/settings/knowledge");
    return { ok: true, message: `Added "${p.data.title}" in ${r.chunks} chunk${r.chunks === 1 ? "" : "s"} — the writer can use it now` };
  } catch (e) {
    return { ok: false, message: `Couldn't index it: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` };
  }
}

export async function deleteDocumentAction(id: string): Promise<KbState> {
  // The client is the one the document belongs to (looked up unscoped, so the check below decides).
  const doc = typeof id === "string" ? await baseDb.knowledgeDoc.findUnique({ where: { id }, select: { sellerId: true, title: true } }) : null;
  if (!doc) return { ok: false, message: "That document no longer exists" };
  let actor: string;
  try {
    actor = await requireClientEditor(doc.sellerId, "knowledge.delete", doc.title);
  } catch (e) {
    return denied(e);
  }
  try {
    await deleteDocument(id);
    await auditClientEdit(actor, "knowledge.delete", doc.sellerId, doc.title);
    revalidatePath("/settings/knowledge");
    return { ok: true, message: "Removed from the knowledge base" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-index the knowledge base in the background (it embeds every document; can take a while). */
export async function reindexAction(): Promise<KbState> {
  const clientId = await activeSellerId();
  let actor: string;
  try {
    actor = await requireClientEditor(clientId, "knowledge.reindex");
  } catch (e) {
    return denied(e);
  }
  // The built-in documents come from the client's own Account Brain: nothing to index until it is complete.
  if (!(await clientBrain(clientId)).ready) return { ok: false, message: "Finish the Account Brain first: the built-in documents come from it" };
  const { startJob } = await import("@/lib/jobs");
  const r = await startJob("reindex", { sellerId: clientId, label: "Re-index the knowledge base", createdBy: actor === "local" ? null : actor });
  if (r.ok) await auditClientEdit(actor, "knowledge.reindex", clientId);
  return { ok: r.ok, message: r.message };
}

export type SearchHit = { title: string; kind: string; origin: string; approved: boolean; score: number; text: string; url: string | null };

/** Search the knowledge of the client in view (read-only; the scoped database keeps it to clients this person has). */
export async function searchAction(query: string, kind?: string): Promise<{ ok: true; hits: SearchHit[] } | { ok: false; message: string }> {
  if (typeof query !== "string" || !query.trim()) return { ok: false, message: "Type something to search for" };
  try {
    const brain = await clientBrain(await activeSellerId());
    if (brain.ready) await ensureIndexed(brain.pack);
    const hits = await retrieve({ sellerId: brain.id, query: query.slice(0, 1000), kinds: typeof kind === "string" && kind ? [kind] : undefined, k: 6, perDoc: 1, minScore: 0 });
    return { ok: true, hits: hits.map(({ title, kind, origin, approved, score, text, url }) => ({ title, kind, origin, approved, score, url, text: text.split("\n").slice(1).join("\n") })) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
