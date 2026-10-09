# Knowledge base (RAG)

What the writer knows about writing outreach, beyond the researched facts about each prospect.
Settings → Knowledge base (`/settings/knowledge`) shows it, lets the team add to it, and has a
search box that runs the same retrieval the writer runs.

## What's in it

| Origin | Kinds | Where it comes from |
|---|---|---|
| Built in | research, playbook | `src/lib/knowledge/sources.ts` (paraphrased findings from published outreach studies, each with its URL) and `src/lib/knowledge/playbook.ts` (one play per channel and step) |
| Built in | persona, norm, objection, example, market fact | the seller pack's `writing` section (`src/lib/seller/manch-writing.ts`, editable in Settings → Seller profile → Edit) |
| Built in | product, case study, competitor | the seller pack's use cases, products, proof points, customers, competitors |
| Added | any | pasted text or a `.md` / `.txt` file: case studies, call notes, objection answers, emails that worked |
| Learned | example | every email that gets a positive reply, tagged with the play and persona it was written for |

**Approved** documents may be stated about the seller in messages (public case studies, product
facts). Everything else is background: the writer learns from it but never quotes it. Claims about
the prospect still need a researched fact, as before.

## How it works

1. **Chunking** (`rag/chunk.ts`): split on headings, then paragraphs, into chunks of about 220 words
   with a short overlap. Each chunk starts with "document title › heading" so it makes sense alone.
2. **Embedding** (`adapters/live/embeddings.ts`): OpenRouter `/api/v1/embeddings`, model
   `openai/text-embedding-3-small` by default (`EMBED_MODEL` to change; the index re-embeds on a
   model change). Without `OPENROUTER_API_KEY` an offline word-hashing embedder is used (tests,
   demos): it matches words, not meaning.
3. **Storage** (`KnowledgeDoc`, `KnowledgeChunk`): vectors in a `double precision[]` column, so any
   Postgres works without the pgvector extension. Built-in docs have stable keys and a content
   hash: re-indexing only re-embeds what changed. Up to a few thousand chunks, similarity is
   computed in the app from an in-memory cache; move to pgvector beyond that.
4. **Retrieval** (`rag/retrieve.ts`): 0.75 × cosine similarity + 0.25 × keyword overlap + small
   boosts for matching play, persona, use case and trigger tags; a hard filter on channel; MMR so
   near-duplicates don't crowd the results; one chunk per document by default.

## Where it's used

- **Drafting** (`stages/outreach.ts` → `rag/for-message.ts`): before each email, a query built
  from the play, persona, title, trigger, use case and lead fact retrieves up to 4 reference chunks
  and up to 2 added or learned examples for the same play. They go into the writer's prompt marked
  APPROVED or BACKGROUND. The draft records the chunk ids it used (`Draft.knowledge.references`),
  and the run log says what was retrieved. If embeddings are unavailable, the email is written
  without the knowledge base and the log says so.
- **Reply suggestions** (People → a person → paste a reply): matching objection answers, case
  studies and competitor notes appear under "From the knowledge base".
- **Learning** (`rag/learn.ts`): a positive reply turns the email that earned it into a learned
  example, so the writer gradually imitates what works for you rather than the starter examples.
