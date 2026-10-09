// Embeddings through OpenRouter (same key as the LLM). Default model: openai/text-embedding-3-small;
// set EMBED_MODEL to change it (the knowledge base re-embeds when the model changes).

import type { Embedder } from "../types";
import { fetchJson } from "./http";

const BATCH = 64;

export class OpenRouterEmbedder implements Embedder {
  readonly live = true;
  readonly model: string;
  constructor(private apiKey: string, model = process.env.EMBED_MODEL?.trim() || "openai/text-embedding-3-small") {
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const input = texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000));
      const res = await fetchJson<{ data?: { embedding: number[]; index?: number }[] }>("OpenRouter embeddings", "https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, "X-Title": "ABM Intelligence" },
        body: JSON.stringify({ model: this.model, input, encoding_format: "float" }),
        timeoutMs: 60_000,
      });
      const data = [...(res.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (data.length !== input.length) throw new Error(`OpenRouter embeddings returned ${data.length} vectors for ${input.length} inputs`);
      out.push(...data.map((d) => d.embedding));
    }
    return out;
  }
}
