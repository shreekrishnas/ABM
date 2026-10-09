// Retrieval: finds the chunks most relevant to a query. Hybrid scoring:
//   score = 0.75 · cosine(query, chunk) + 0.25 · keyword overlap + tag boosts
// Keyword overlap rescues exact terms embeddings blur (product names, tax ids, a persona's
// title); tag boosts prefer chunks written for this channel, play and persona.
// Results are diversified (MMR) so three near-identical chunks don't crowd out the rest,
// and at most `perDoc` chunks come from one document.

import { db } from "@/lib/db";
import { getAdapters } from "@/lib/adapters";
import type { Embedder } from "@/lib/adapters/types";
import { terms } from "@/lib/adapters/hash-embedder";
import type { DocTags } from "./corpus";
import { indexGeneration } from "./store";

export interface RetrieveQuery {
  sellerId: string;
  query: string;
  kinds?: string[];
  /** Soft preferences: matching tags raise the score; nothing is excluded for missing tags. */
  prefer?: DocTags;
  /** Hard filter on channel: chunks tagged for another channel are dropped. */
  channel?: "email" | "linkedin";
  k?: number;
  perDoc?: number;
  minScore?: number;
}

export interface Hit {
  chunkId: string;
  docId: string;
  title: string;
  kind: string;
  origin: string;
  approved: boolean;
  url: string | null;
  tags: DocTags | null;
  text: string;
  score: number;
}

interface Cached {
  id: string;
  docId: string;
  kind: string;
  text: string;
  vec: number[];
  terms: Set<string>;
  doc: { title: string; origin: string; approved: boolean; url: string | null; tags: DocTags | null };
}

// In-memory cache of one seller's chunks for one model; reloaded when the index changes.
let cache: { key: string; gen: number; at: number; rows: Cached[] } | null = null;
/** Other server instances may have written; reload at least this often. */
const CACHE_MS = 60_000;

async function load(sellerId: string, model: string): Promise<Cached[]> {
  const key = `${sellerId}|${model}`;
  if (cache && cache.key === key && cache.gen === indexGeneration() && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const gen = indexGeneration();
  const rows = await db.knowledgeChunk.findMany({
    where: { sellerId, embedModel: model },
    select: { id: true, docId: true, kind: true, text: true, embedding: true, doc: { select: { title: true, origin: true, approved: true, url: true, tags: true } } },
  });
  const out = rows.map((r) => ({ id: r.id, docId: r.docId, kind: r.kind, text: r.text, vec: r.embedding, terms: new Set(terms(r.text)), doc: { ...r.doc, tags: (r.doc.tags as DocTags | null) ?? null } }));
  cache = { key, gen, at: Date.now(), rows: out };
  return out;
}

/** Test hook: drop the cache (another process may have written). */
export function clearRetrievalCache() {
  cache = null;
}

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
};
const norm = (a: number[]) => Math.sqrt(dot(a, a)) || 1;
const cosine = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));

function tagBoost(tags: DocTags | null, p: DocTags | undefined) {
  if (!tags || !p) return 0;
  const hit = (a?: string[], b?: string[]) => Boolean(a?.length && b?.some((x) => a.includes(x)));
  return (hit(tags.plays, p.plays) ? 0.12 : 0) + (hit(tags.personas, p.personas) ? 0.1 : 0) + (hit(tags.useCases, p.useCases) ? 0.06 : 0) + (hit(tags.triggers, p.triggers) ? 0.04 : 0);
}

export async function retrieve(q: RetrieveQuery, e: Embedder = getAdapters().embedder): Promise<Hit[]> {
  const rows = await load(q.sellerId, e.model);
  if (!rows.length || !q.query.trim()) return [];
  const [qv] = await e.embed([q.query]);
  const qt = new Set(terms(q.query));
  const scored = rows
    .filter((r) => (!q.kinds || q.kinds.includes(r.kind)) && (!q.channel || !r.doc.tags?.channel || r.doc.tags.channel === q.channel))
    .map((r) => {
      let overlap = 0;
      for (const t of qt) if (r.terms.has(t)) overlap++;
      const kw = qt.size ? overlap / Math.sqrt(qt.size * Math.max(1, r.terms.size)) : 0;
      return { r, score: 0.75 * cosine(qv, r.vec) + 0.25 * Math.min(1, kw * 2) + tagBoost(r.doc.tags, q.prefer) };
    })
    .filter((x) => x.score >= (q.minScore ?? 0.05))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  // MMR: trade relevance against similarity to what is already picked.
  const k = q.k ?? 5;
  const perDoc = q.perDoc ?? 1;
  const picked: typeof scored = [];
  const fromDoc = new Map<string, number>();
  while (picked.length < k) {
    let best: (typeof scored)[number] | null = null;
    let bestVal = -Infinity;
    for (const c of scored) {
      if (picked.includes(c) || (fromDoc.get(c.r.docId) ?? 0) >= perDoc) continue;
      const sim = picked.length ? Math.max(...picked.map((p) => cosine(p.r.vec, c.r.vec))) : 0;
      const val = 0.75 * c.score - 0.25 * sim;
      if (val > bestVal) {
        bestVal = val;
        best = c;
      }
    }
    if (!best) break;
    picked.push(best);
    fromDoc.set(best.r.docId, (fromDoc.get(best.r.docId) ?? 0) + 1);
  }
  return picked.map(({ r, score }) => ({ chunkId: r.id, docId: r.docId, title: r.doc.title, kind: r.kind, origin: r.doc.origin, approved: r.doc.approved, url: r.doc.url, tags: r.doc.tags, text: r.text, score: Math.round(score * 1000) / 1000 }));
}
