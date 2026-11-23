# Integrations review (stabilization sprint)

From the code (file references), with mocked calls only: no paid request was made and no live setting
changed. "Not verified" = the code doesn't show it and it wasn't tested live.

| Integration | Calls (code) | Auth | Pages | Retries, limits, errors | Attribution, storage | Gaps |
|---|---|---|---|---|---|---|
| **OpenRouter** (writing, reading, Vega) `adapters/live/openrouter.ts` | `/api/v1/chat/completions` | key (Admin → Integrations) | n/a | shared helper `fetchJson` (`adapters/live/http.ts`): timeout, retries on 429/5xx/network honouring Retry-After, pause after repeated failures; credit-limit errors raise the "AI is blocked" alert | every call costed in the ledger; AI pause stops all use | answer quality not checked live (AI off) |
| **Embeddings** `adapters/live/embeddings.ts` | OpenRouter `/api/v1/embeddings` (`EMBED_MODEL`) | same key | batches | `fetchJson` | knowledge chunks | n/a |
| **Web search** `adapters/live/research.ts` | Exa `/search`, `/findSimilar`; Tavily `/search`; SerpAPI `/search.json` | keys per provider | top results only (by design) | `fetchJson` | every fact keeps its source URL and date (Evidence) | provider result caps not configurable from the app |
| **Website reader** `adapters/live/reader.ts` | the company's own pages | none | n/a | timeout per page, no retry (a failed page is skipped and said) | page URL stored with what was read | robots handling not verified |
| **BuiltWith** `profile/builtwith.ts` | `api.builtwith.com/v21` | `BUILTWITH_API_KEY` | n/a | `fetchJson` | technologies with source | n/a |
| **Apollo** `adapters/live/apollo.ts` | people search, person match (email, 1 credit, approval-gated), organization enrich by domain (batches ≤100), account lists (website visitors) | `APOLLO_API_KEY` (x-api-key) | visitor list: every page (now up to 20 × 100; a longer list is recorded, not cut silently); people search page 1, ≤10 per function (by design) | **was: no retry** (a 429 or blip failed the run); **now `fetchJson`**: retries on 429/5xx with Retry-After, pause after repeated failures, clear 403/429 messages | visits per client (P3); people with source "apollo" | visit dates depend on what Apollo exposes per account (handled: unknown dates shown as unknown) |
| **Email (SMTP)** `adapters/live/email.ts` | SMTP via `SMTP_URL` | SMTP credentials | n/a | single attempt per email with an idempotency key; a missing connection holds every email; bounce breaker | messages, bounces, replies stored; audit log | **no screen to add a sending mailbox** (production: 0); see docs/EMAIL-READINESS.md |
| **Website tracking** `/api/v1/track` (inbound) | script and tracked links | signed contact tokens | n/a | per-address rate limit | visits per client (P3) | n/a |
| **Webhooks, replies** `/api/v1/replies`, `/signals` (inbound) | from mail and other tools | bearer key or client key; signature check | n/a | rate limited | stored per client | n/a |

## Changed in this sprint
- Apollo moved onto the shared helper (retries, backoff with Retry-After, pause for a failing service, clear messages); tests with a mocked fetch: tests/apollo-http.test.ts.
- Apollo's website-visitor list: read up to 20 pages (was 5, so 500 companies), and a longer list is recorded on the run instead of cut silently (production list: 276 companies).

## Architecture note
Every outbound JSON API should go through `fetchJson` (one place for timeouts, retries, rate limits and service pauses). After this sprint the remaining direct callers are the website reader (deliberately: a page that fails is skipped) and SMTP (not HTTP).
