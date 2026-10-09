"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DEFAULT_SELLER_ID, ensureSellerPacks, sellerFor } from "@/lib/seller";
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

export async function addDocumentAction(_: KbState, fd: FormData): Promise<KbState> {
  const p = docInput.safeParse({ title: fd.get("title"), text: fd.get("text"), kind: fd.get("kind"), url: fd.get("url") ?? "" });
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const channel = fd.get("channel");
  try {
    await ensureSellerPacks();
    const sp = sellerFor(DEFAULT_SELLER_ID);
    const r = await addDocument({
      sellerId: sp.id, title: p.data.title, text: p.data.text, kind: p.data.kind, url: p.data.url || null, approved: fd.get("approved") === "on",
      tags: { channel: channel === "email" || channel === "linkedin" ? channel : undefined, personas: list(fd.get("personas")), plays: list(fd.get("plays")) },
    });
    revalidatePath("/settings/knowledge");
    return { ok: true, message: `Added "${p.data.title}" in ${r.chunks} chunk${r.chunks === 1 ? "" : "s"} — the writer can use it now` };
  } catch (e) {
    return { ok: false, message: `Couldn't index it: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` };
  }
}

export async function deleteDocumentAction(id: string): Promise<KbState> {
  try {
    await deleteDocument(id);
    revalidatePath("/settings/knowledge");
    return { ok: true, message: "Removed from the knowledge base" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function reindexAction(): Promise<KbState> {
  try {
    await ensureSellerPacks();
    forgetSync();
    clearRetrievalCache();
    const r = await syncBuiltIns(sellerFor(DEFAULT_SELLER_ID));
    revalidatePath("/settings/knowledge");
    return { ok: true, message: `Up to date: ${r.docs} built-in documents, ${r.embedded} re-embedded${r.removed ? `, ${r.removed} removed` : ""}` };
  } catch (e) {
    return { ok: false, message: `Re-index failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` };
  }
}

export type SearchHit = { title: string; kind: string; origin: string; approved: boolean; score: number; text: string; url: string | null };

export async function searchAction(query: string, kind?: string): Promise<{ ok: true; hits: SearchHit[] } | { ok: false; message: string }> {
  if (!query.trim()) return { ok: false, message: "Type something to search for" };
  try {
    await ensureSellerPacks();
    const sp = sellerFor(DEFAULT_SELLER_ID);
    await ensureIndexed(sp);
    const hits = await retrieve({ sellerId: sp.id, query: query.slice(0, 1000), kinds: kind ? [kind] : undefined, k: 6, perDoc: 1, minScore: 0 });
    return { ok: true, hits: hits.map(({ title, kind, origin, approved, score, text, url }) => ({ title, kind, origin, approved, score, url, text: text.split("\n").slice(1).join("\n") })) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
