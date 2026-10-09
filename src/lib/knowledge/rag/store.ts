// Indexing: documents in, chunks with embeddings out. Unchanged documents (same
// content hash, same embedding model) are skipped, so re-indexing is cheap.

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Embedder } from "@/lib/adapters/types";
import { getAdapters } from "@/lib/adapters";
import { seller } from "@/lib/seller";
import { chunkDocument } from "./chunk";
import { builtInCorpus, type CorpusDoc, type DocTags } from "./corpus";

export const DOC_KINDS = ["playbook", "persona", "objection", "example", "market_fact", "norm", "research", "case_study", "product", "competitor", "document"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const docHash = (d: { title: string; text: string; tags?: unknown; approved: boolean; kind: string }, model: string) =>
  createHash("sha256").update(JSON.stringify([d.title, d.text, d.tags ?? null, d.approved, d.kind, model])).digest("hex").slice(0, 16);

const embedder = (): Embedder => getAdapters().embedder;

/** Bumped on every write, so the in-memory search cache knows to reload. */
let generation = 0;
export const indexGeneration = () => generation;

async function writeChunks(docId: string, sellerId: string, kind: string, title: string, text: string, e: Embedder) {
  const chunks = chunkDocument(title, text);
  const vectors = chunks.length ? await e.embed(chunks.map((c) => c.text)) : [];
  await db.$transaction([
    db.knowledgeChunk.deleteMany({ where: { docId } }),
    db.knowledgeChunk.createMany({ data: chunks.map((c, i) => ({ docId, sellerId, kind, ord: c.ord, heading: c.heading, text: c.text, embedding: vectors[i], embedModel: e.model })) }),
  ]);
  generation++;
  return chunks.length;
}

/** Insert or update one keyed document (built-in or learned). Returns whether it was (re)embedded. */
export async function upsertKeyedDoc(sellerId: string, origin: "built_in" | "learned", d: CorpusDoc, e: Embedder = embedder()): Promise<boolean> {
  const hash = docHash(d, e.model);
  const existing = await db.knowledgeDoc.findUnique({ where: { sellerId_key: { sellerId, key: d.key } }, select: { id: true, hash: true } });
  if (existing?.hash === hash) return false;
  const data = { origin, kind: d.kind, title: d.title, text: d.text, url: d.url ?? null, tags: (d.tags ?? undefined) as Prisma.InputJsonValue | undefined, approved: d.approved, hash };
  const doc = existing ? await db.knowledgeDoc.update({ where: { id: existing.id }, data }) : await db.knowledgeDoc.create({ data: { sellerId, key: d.key, ...data } });
  await writeChunks(doc.id, sellerId, d.kind, d.title, d.text, e);
  return true;
}

/**
 * Bring the built-in documents in line with the code and the seller pack: add new,
 * re-embed changed, remove ones that no longer exist. Also re-embeds everything when
 * the embedding model changed.
 */
export async function syncBuiltIns(sp = seller(), e: Embedder = embedder()) {
  const corpus = builtInCorpus(sp);
  let embedded = 0;
  for (const d of corpus) if (await upsertKeyedDoc(sp.id, "built_in", d, e)) embedded++;
  const keys = corpus.map((d) => d.key);
  const removed = await db.knowledgeDoc.deleteMany({ where: { sellerId: sp.id, origin: "built_in", key: { notIn: keys } } });
  // Uploaded and learned docs embedded with another model are re-embedded too.
  const stale = await db.knowledgeDoc.findMany({ where: { sellerId: sp.id, origin: { not: "built_in" }, chunks: { some: { embedModel: { not: e.model } } } } });
  for (const d of stale) {
    await writeChunks(d.id, sp.id, d.kind, d.title, d.text, e);
    await db.knowledgeDoc.update({ where: { id: d.id }, data: { hash: docHash({ ...d, tags: d.tags ?? undefined }, e.model) } });
    embedded++;
  }
  if (removed.count) generation++;
  return { docs: corpus.length, embedded, removed: removed.count };
}

const synced = new Map<string, string>();

/**
 * Sync built-ins when their content (or the embedding model) changed since this process
 * last synced. The check is in memory, so it is safe to call before every draft; the
 * first call in a fresh process compares hashes with the database once.
 */
export async function ensureIndexed(sp = seller(), e: Embedder = embedder()) {
  const h = createHash("sha256").update(JSON.stringify([builtInCorpus(sp), e.model])).digest("hex");
  if (synced.get(sp.id) === h) return null;
  const r = await syncBuiltIns(sp, e);
  synced.set(sp.id, h);
  return r;
}

/** Test hook. */
export function forgetSync() {
  synced.clear();
}

/** A document a person adds (pasted text or an uploaded .md/.txt file). */
export async function addDocument(input: { sellerId: string; title: string; text: string; kind: DocKind; tags?: DocTags; approved: boolean; url?: string | null }, e: Embedder = embedder()) {
  const title = input.title.trim().slice(0, 200);
  const text = input.text.trim();
  const doc = await db.knowledgeDoc.create({
    data: { sellerId: input.sellerId, origin: "upload", kind: input.kind, title, text, url: input.url ?? null, tags: (input.tags ?? undefined) as Prisma.InputJsonValue | undefined, approved: input.approved, hash: docHash({ ...input, title, text }, e.model) },
  });
  const chunks = await writeChunks(doc.id, input.sellerId, input.kind, title, text, e);
  return { id: doc.id, chunks };
}

export async function deleteDocument(id: string) {
  const d = await db.knowledgeDoc.findUnique({ where: { id }, select: { origin: true } });
  if (!d) return false;
  if (d.origin === "built_in") throw new Error("Built-in documents come from the code and seller pack; edit them there");
  await db.knowledgeDoc.delete({ where: { id } });
  generation++;
  return true;
}

export async function knowledgeStats(sellerId: string) {
  const [byKind, chunks, models, last] = await Promise.all([
    db.knowledgeDoc.groupBy({ by: ["origin", "kind"], where: { sellerId }, _count: true }),
    db.knowledgeChunk.count({ where: { sellerId } }),
    db.knowledgeChunk.groupBy({ by: ["embedModel"], where: { sellerId }, _count: true }),
    db.knowledgeDoc.findFirst({ where: { sellerId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  return { byKind, chunks, models: models.map((m) => ({ model: m.embedModel, chunks: m._count })), lastUpdated: last?.updatedAt ?? null };
}
