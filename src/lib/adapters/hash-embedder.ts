// Offline embedder: feature hashing of words and word pairs into a fixed-size vector.
// No network, deterministic, good enough to find text that shares vocabulary. Used for
// tests, demos and as the fallback when no embedding API is configured. The live
// embedder (OpenRouter) understands meaning; this one only understands words.

import type { Embedder } from "./types";

const DIMS = 512;
const STOP = new Set("a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when which who will with you your".split(" "));

/** Lowercase words without stop words, lightly stemmed so "onboarding" ≈ "onboard". */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9₹]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ings|ing|ers|er|es|s|ed)$/, "").slice(0, 24) || w);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function hashEmbed(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  const t = terms(text);
  const add = (f: string, w: number) => {
    const h = hash(f);
    v[h % DIMS] += h & 0x80000000 ? -w : w;
  };
  t.forEach((w, i) => {
    add(w, 1);
    if (i > 0) add(`${t[i - 1]}_${w}`, 0.5);
  });
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export class HashEmbedder implements Embedder {
  readonly model = "hash-v1";
  readonly live = false;
  async embed(texts: string[]) {
    return texts.map(hashEmbed);
  }
}
